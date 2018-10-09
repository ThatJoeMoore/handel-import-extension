import { S3 } from 'aws-sdk';
import {
    DeployContext,
    DeployOutputType,
    PreDeployContext,
    ProduceEventsContext,
    ServiceConfig,
    ServiceContext,
    ServiceDeployer,
    ServiceEventConsumer,
    ServiceEventType,
    UnDeployContext
} from 'handel-extension-api';
import { awsCalls } from 'handel-extension-support';
import * as winston from 'winston';

const SERVICE_NAME = 'S3-importer';

export declare interface S3ImportConfig extends ServiceConfig {
    bucket_name: string;
}

function applyNameTemplate(template: string, serviceContext: ServiceContext<S3ImportConfig>) {
    return template
        .replace(/<account_id>/g, serviceContext.accountConfig.account_id)
        .replace(/<region>/g, serviceContext.accountConfig.region)
        ;
}

export class S3Service implements ServiceDeployer {

    public readonly consumedDeployOutputTypes = [];
    public readonly producedDeployOutputTypes = [
        DeployOutputType.EnvironmentVariables,
        DeployOutputType.Policies
    ];

    public readonly providedEventType = ServiceEventType.S3;

    public readonly producedEventsSupportedTypes = [
        ServiceEventType.Lambda,
        ServiceEventType.SNS,
        ServiceEventType.SQS
    ];

    public readonly supportsTagging = true;

    public check(serviceContext: ServiceContext<S3ImportConfig>, dependenciesServiceContexts: Array<ServiceContext<ServiceConfig>>): string[] {
        const params = serviceContext.params;
        const errors: string[] = [];
        if (!params.bucket_name) {
            errors.push(`${SERVICE_NAME} - must provide a bucket name`);
        }
        return errors;
    }

    public async deploy(ownServiceContext: ServiceContext<S3ImportConfig>, ownPreDeployContext: PreDeployContext, dependenciesDeployContexts: DeployContext[]): Promise<DeployContext> {
        const {bucket_name: providedName} = ownServiceContext.params;

        const actualName = applyNameTemplate(providedName, ownServiceContext);

        console.log('Implement deploy phase here!');
        const bucket = await awsCalls.s3.getBucket(actualName);
        if (!bucket) {
            throw new Error(`Cannot find bucket named ${actualName}`);
        }

        const bucketName = bucket.Name as string;
        const arn = `arn:aws:s3:::${bucketName}`;

        const deployContext = new DeployContext(ownServiceContext);

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
            serviceEventType: ServiceEventType.S3
        };

        return deployContext;
    }

    public async unDeploy(ownServiceContext: ServiceContext<S3ImportConfig>): Promise<UnDeployContext> {
        // We don't really need to do anything, since everybody will just undo themselves. Yay Handel!
        return new UnDeployContext(ownServiceContext);
    }

    public async produceEvents(ownServiceContext: ServiceContext<S3ImportConfig>, ownDeployContext: DeployContext, eventConsumerConfig: S3ServiceEventConsumer, consumerServiceContext: ServiceContext<ServiceConfig>, consumerDeployContext: DeployContext): Promise<ProduceEventsContext> {
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
        const result = await configureBucketNotifications(bucketName, consumerEventType, consumerArn, eventConsumerConfig.bucket_events, filters);
        winston.info(`${SERVICE_NAME} - Configured production of events from '${ownServiceContext.serviceName}' for consumer '${consumerServiceContext.serviceName}'`);
        return new ProduceEventsContext(ownServiceContext, consumerServiceContext);
    }
}

interface S3ServiceEventConsumer extends ServiceEventConsumer {
    bucket_events: S3ServiceEventEventsList;
    filters?: S3ServiceEventFilterList;
}

type S3ServiceEventEventsList = string[];
type S3ServiceEventFilterList = S3ServiceEventFilter[];

interface S3ServiceEventFilter {
    name: S3ServiceEventFilterName;
    value: string;
}

enum S3ServiceEventFilterName {
    SUFFIX = 'suffix',
    PREFIX = 'prefix'
}

function getS3EventFilters(filterList: S3ServiceEventFilterList | undefined): AWS.S3.FilterRuleList {
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

async function configureBucketNotifications(bucketName: string, notificationType: ServiceEventType, notificationArn: string, notificationEvents: AWS.S3.EventList, eventFilters: AWS.S3.FilterRuleList) {
    const putNotificationParams: AWS.S3.PutBucketNotificationConfigurationRequest = {
        Bucket: bucketName,
        NotificationConfiguration: {}
    };

    // Configure filters if any provided
    let filterConfig: AWS.S3.NotificationConfigurationFilter | null = null;
    if (eventFilters.length > 0) {
        filterConfig = {
            Key: {
                FilterRules: eventFilters
            },
        };
    }

    if (notificationType === ServiceEventType.Lambda) {
        putNotificationParams.NotificationConfiguration.LambdaFunctionConfigurations = [{
            LambdaFunctionArn: notificationArn,
            Events: notificationEvents,
        }];
        if (filterConfig) {
            putNotificationParams.NotificationConfiguration.LambdaFunctionConfigurations[0].Filter = filterConfig;
        }
    }
    else if (notificationType === ServiceEventType.SNS) {
        putNotificationParams.NotificationConfiguration.TopicConfigurations = [{
            TopicArn: notificationArn,
            Events: notificationEvents
        }];
        if (filterConfig) {
            putNotificationParams.NotificationConfiguration.TopicConfigurations[0].Filter = filterConfig;
        }
    }
    else if (notificationType === ServiceEventType.SQS) {
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
    const s3 = new S3();
    return await s3.putBucketNotificationConfiguration(putNotificationParams).promise();
}
