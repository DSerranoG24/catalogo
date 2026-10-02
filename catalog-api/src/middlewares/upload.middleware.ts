import multer from "multer";
import { NextFunction, Request, Response } from "express";
import { detectImageMimeType } from "../utils/image-validation";

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(Object.assign(new Error("Tipo de imagen no permitido"), { code: "INVALID_IMAGE_TYPE" }));
    }

    cb(null, true);
  },
});

export function validateImageContent(req: Request, res: Response, next: NextFunction) {
  if (!req.file) return next();

  if (detectImageMimeType(req.file.buffer) !== req.file.mimetype) {
    return res.status(400).json({
      success: false,
      error: "INVALID_IMAGE_CONTENT",
      message: "El contenido del archivo no coincide con su tipo de imagen.",
    });
  }

  next();
}