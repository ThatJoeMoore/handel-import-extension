"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = require("aws-sdk");
const handel_extension_api_1 = require("handel-extension-api");
const handel_extension_support_1 = require("handel-extension-support");
const winston = require("winston");
const SERVICE_NAME = 'S3-importer';
function applyNameTemplate(template, serviceContext) {
    return template
        .replace(/<account_id>/g, serviceContext.accountConfig.account_id)
        .replace(/<region>/g, serviceContext.accountConfig.region);
}
class S3Service {
    constructor() {
        this.consumedDeployOutputTypes = [];
        this.producedDeployOutputTypes = [
            handel_extension_api_1.DeployOutputType.EnvironmentVariables,
            handel_extension_api_1.DeployOutputType.Policies
        ];
        this.providedEventType = handel_extension_api_1.ServiceEventType.S3;
        this.producedEventsSupportedTypes = [
            handel_extension_api_1.ServiceEventType.Lambda,
            handel_extension_api_1.ServiceEventType.SNS,
            handel_extension_api_1.ServiceEventType.SQS
        ];
        this.supportsTagging = true;
    }
    check(serviceContext, dependenciesServiceContexts) {
        const params = serviceContext.params;
        const errors = [];
        if (!params.bucket_name) {
            errors.push(`${SERVICE_NAME} - must provide a bucket name`);
        }
        return errors;
    }
    deploy(ownServiceContext, ownPreDeployContext, dependenciesDeployContexts) {
        return __awaiter(this, void 0, void 0, function* () {
            const { bucket_name: providedName } = ownServiceContext.params;
            const actualName = applyNameTemplate(providedName, ownServiceContext);
            console.log('Implement deploy phase here!');
            const bucket = yield handel_extension_support_1.awsCalls.s3.getBucket(actualName);
            if (!bucket) {
                throw new Error(`Cannot find bucket named ${actualName}`);
            }
            const bucketName = bucket.Name;
            const arn = `arn:aws:s3:::${bucketName}`;
            const deployContext = new handel_extension_api_1.DeployContext(ownServiceContext);
            deployContext.addEnvironmentVariables({
                BUCKET_NAME: bucketName,
                BUCKET_ARN: arn,
                BUCKET_URL: `https://${bucketName}.s3.amazonaws.com/`,
                REGION_ENDPOINT: `s3-${ownServiceContext.accountConfig.region}.amazonaws.com`
            });
            deployContext.policies.push({
                'Effect': 'Allow',
                'Action': [
                    's3:ListBucket'
                ],
                'Resource': [
                    `arn:aws:s3:::${bucketName}`
                ]
            });
            deployContext.policies.push({
                'Effect': 'Allow',
                'Action': [
                    's3:PutObject',
                    's3:GetObject',
                    's3:DeleteObject',
                    's3:GetObjectAcl',
                    's3:PutObjectAcl',
                    's3:DeleteObjectAcl'
                ],
                'Resource': [
                    `arn:aws:s3:::${bucketName}/*`
                ]
            });
            // Output certain information for events
            deployContext.eventOutputs = {
                resourceName: bucketName,
                resourceArn: arn,
                resourcePrincipal: 's3.amazonaws.com',
                serviceEventType: handel_extension_api_1.ServiceEventType.S3
            };
            return deployContext;
        });
    }
    unDeploy(ownServiceContext) {
        return __awaiter(this, void 0, void 0, function* () {
            // We don't really need to do anything, since everybody will just undo themselves. Yay Handel!
            return new handel_extension_api_1.UnDeployContext(ownServiceContext);
        });
    }
    produceEvents(ownServiceContext, ownDeployContext, eventConsumerConfig, consumerServiceContext, consumerDeployContext) {
        return __awaiter(this, void 0, void 0, function* () {
            winston.info(`${SERVICE_NAME} - Producing events from '${ownServiceContext.serviceName}' for consumer '${consumerServiceContext.serviceName}'`);
            if (!ownDeployContext.eventOutputs || !consumerDeployContext.eventOutputs) {
                throw new Error(`${SERVICE_NAME} - Both the consumer and producer must return event outputs from their deploy`);
            }
            const bucketName = ownDeployContext.eventOutputs.resourceName;
            const consumerArn = consumerDeployContext.eventOutputs.resourceArn;
            if (!bucketName || !consumerArn) {
                throw new Error(`${SERVICE_NAME} - Expected bucket name and consumer ARN in deploy outputs`);
            }
            const consumerEventType = consumerDeployContext.eventOutputs.serviceEventType;
            if (!this.producedEventsSupportedTypes.includes(consumerEventType)) {
                throw new Error(`${SERVICE_NAME} - Unsupported event consumer type given: ${consumerEventType}`);
            }
            const filters = getS3EventFilters(eventConsumerConfig.filters);
            const result = yield configureBucketNotifications(bucketName, consumerEventType, consumerArn, eventConsumerConfig.bucket_events, filters);
            winston.info(`${SERVICE_NAME} - Configured production of events from '${ownServiceContext.serviceName}' for consumer '${consumerServiceContext.serviceName}'`);
            return new handel_extension_api_1.ProduceEventsContext(ownServiceContext, consumerServiceContext);
        });
    }
}
exports.S3Service = S3Service;
var S3ServiceEventFilterName;
(function (S3ServiceEventFilterName) {
    S3ServiceEventFilterName["SUFFIX"] = "suffix";
    S3ServiceEventFilterName["PREFIX"] = "prefix";
})(S3ServiceEventFilterName || (S3ServiceEventFilterName = {}));
function getS3EventFilters(filterList) {
    if (filterList) {
        return filterList.map(item => {
            return {
                Name: item.name,
                Value: item.value
            };
        });
    }
    else {
        return [];
    }
}
function configureBucketNotifications(bucketName, notificationType, notificationArn, notificationEvents, eventFilters) {
    return __awaiter(this, void 0, void 0, function* () {
        const putNotificationParams = {
            Bucket: bucketName,
            NotificationConfiguration: {}
        };
        // Configure filters if any provided
        let filterConfig = null;
        if (eventFilters.length > 0) {
            filterConfig = {
                Key: {
                    FilterRules: eventFilters
                },
            };
        }
        if (notificationType === handel_extension_api_1.ServiceEventType.Lambda) {
            putNotificationParams.NotificationConfiguration.LambdaFunctionConfigurations = [{
                    LambdaFunctionArn: notificationArn,
                    Events: notificationEvents,
                }];
            if (filterConfig) {
                putNotificationParams.NotificationConfiguration.LambdaFunctionConfigurations[0].Filter = filterConfig;
            }
        }
        else if (notificationType === handel_extension_api_1.ServiceEventType.SNS) {
            putNotificationParams.NotificationConfiguration.TopicConfigurations = [{
                    TopicArn: notificationArn,
                    Events: notificationEvents
                }];
            if (filterConfig) {
                putNotificationParams.NotificationConfiguration.TopicConfigurations[0].Filter = filterConfig;
            }
        }
        else if (notificationType === handel_extension_api_1.ServiceEventType.SQS) {
            putNotificationParams.NotificationConfiguration.QueueConfigurations = [{
                    QueueArn: notificationArn,
                    Events: notificationEvents
                }];
            if (filterConfig) {
                putNotificationParams.NotificationConfiguration.QueueConfigurations[0].Filter = filterConfig;
            }
        }
        else {
            throw new Error(`Invalid/unsupported notification type from S3 bucket specified: ${notificationType}`);
        }
        const s3 = new aws_sdk_1.S3();
        return yield s3.putBucketNotificationConfiguration(putNotificationParams).promise();
    });
}
//# sourceMappingURL=service.js.map