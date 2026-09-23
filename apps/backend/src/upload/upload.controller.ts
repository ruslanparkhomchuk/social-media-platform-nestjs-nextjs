import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadService } from "./upload.service";
import {
  FileSizeValidationPipe,
  FileTypeValidationPipe,
} from "./file-validation.pipe";
import { multerConfig } from "./upload.config";
import { Throttle } from "@nestjs/throttler";

@Controller("upload")
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post("image")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor("image", multerConfig))
  async uploadFile(
    @UploadedFile(new FileSizeValidationPipe(), new FileTypeValidationPipe())
    file: Express.Multer.File,
  ) {
    return this.uploadService.uploadImage(file);
  }
}
