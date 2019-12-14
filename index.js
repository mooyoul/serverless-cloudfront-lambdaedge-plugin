'use strict';

const util = require('util');

class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:finalize': this.updateLambdaVersion.bind(this)
    };
  }

  updateLambdaVersion() {
    // Lookup LambdaFunctionAssociations directives
    const associations = this.listLambdaFunctionAssociations();

    // Lookup AWS::Lambda::Version resources and return versions as Map<FunctionName, LambdaVersionLogicalId>
    const lambdaVersions = this.listLambdaVersions();

    for (const association of associations) {
      const functionName = association.LambdaFunctionARN;
      const functionVersionLogicalId = lambdaVersions.get(functionName);

      // If Lambda Version resource exists, Mutate value to reference of AWS::Lambda::Version Resource
      if (functionVersionLogicalId) {
        association.LambdaFunctionARN = { Ref: functionVersionLogicalId };

        this.log('Replaced LambdaFunctionAssociation.%s to %s', functionName, functionVersionLogicalId);
      } else {
        this.log('Could not found appropriate version of LambdaFunctionAssociation.%s. Skipping.', functionName);
      }
    }
  }

  listLambdaFunctionAssociations() {
    const resources = this.serverless.service.resources.Resources;

    return Object.keys(resources).reduce((collection, key) => {
      const resource = resources[key];

      if (resource.Type === 'AWS::CloudFront::Distribution') {
        const config = resource.Properties && resource.Properties.DistributionConfig;
        if (config) {
          const cacheBehaviors = [config.DefaultCacheBehavior, ...(config.CacheBehaviors || [])]
            .reduce((memo, behavior) => {
              if (behavior && behavior.LambdaFunctionAssociations) {
                memo.push(...behavior.LambdaFunctionAssociations);
              }

              return memo;
            }, []);

          collection.push(...cacheBehaviors);
        }
      }

      return collection;
    }, []);
  }

  listLambdaVersions() {
    const functions = this.serverless.service.getAllFunctions();
    const compiledTemplate = this.serverless.service.provider.compiledCloudFormationTemplate;

    const nameLogicalIdPairs = functions.map((name) => {
      const versionOutputLogicalId = this.serverless.providers.aws.naming.getLambdaVersionOutputLogicalId(name);
      const versionOutput = compiledTemplate.Outputs[versionOutputLogicalId];

      const versionLogicalId = versionOutput && versionOutput.Value && versionOutput.Value.Ref;

      return [name, versionLogicalId];
    });

    return new Map(nameLogicalIdPairs);
  }

  log(...args) {
    const TAG = '[serverless-cloudfront-lambdaedge-plugin]';

    if (typeof args[0] === 'string') {
      args[0] = `${TAG} ${args[0]}`;
    } else {
      args.unshift(TAG);
    }

    this.serverless.cli.log(util.format(...args));
  }
}

module.exports = ServerlessPlugin;
