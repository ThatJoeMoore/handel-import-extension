import { DeployContext, DeployOutputType, PreDeployContext, ProduceEventsContext, ServiceConfig, ServiceContext, ServiceDeployer, ServiceEventConsumer, ServiceEventType, UnDeployContext } from 'handel-extension-api';
export declare interface S3ImportConfig extends ServiceConfig {
    bucket_name: string;
}
export declare class S3Service implements ServiceDeployer {
    readonly consumedDeployOutputTypes: never[];
    readonly producedDeployOutputTypes: DeployOutputType[];
    readonly providedEventType = ServiceEventType.S3;
    readonly producedEventsSupportedTypes: ServiceEventType[];
    readonly supportsTagging = true;
    check(serviceContext: ServiceContext<S3ImportConfig>, dependenciesServiceContexts: Array<ServiceContext<ServiceConfig>>): string[];
    deploy(ownServiceContext: ServiceContext<S3ImportConfig>, ownPreDeployContext: PreDeployContext, dependenciesDeployContexts: DeployContext[]): Promise<DeployContext>;
    unDeploy(ownServiceContext: ServiceContext<S3ImportConfig>): Promise<UnDeployContext>;
    produceEvents(ownServiceContext: ServiceContext<S3ImportConfig>, ownDeployContext: DeployContext, eventConsumerConfig: S3ServiceEventConsumer, consumerServiceContext: ServiceContext<ServiceConfig>, consumerDeployContext: DeployContext): Promise<ProduceEventsContext>;
}
interface S3ServiceEventConsumer extends ServiceEventConsumer {
    bucket_events: S3ServiceEventEventsList;
    filters?: S3ServiceEventFilterList;
}
declare type S3ServiceEventEventsList = string[];
declare type S3ServiceEventFilterList = S3ServiceEventFilter[];
interface S3ServiceEventFilter {
    name: S3ServiceEventFilterName;
    value: string;
}
declare enum S3ServiceEventFilterName {
    SUFFIX = "suffix",
    PREFIX = "prefix"
}
export {};
