"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const service_1 = require("./service");
function loadHandelExtension(context) {
    context.service('s3', new service_1.S3Service());
}
exports.loadHandelExtension = loadHandelExtension;
//# sourceMappingURL=extension.js.map