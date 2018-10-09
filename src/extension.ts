import {
    ExtensionContext,
} from 'handel-extension-api';
import { S3Service } from './service';

export function loadHandelExtension(context: ExtensionContext) {
    context.service('s3', new S3Service());
}
