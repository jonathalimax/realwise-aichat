import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const requestId = getRequestId(request);

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        code: "VALIDATION_ERROR",
        message: "Dados inválidos.",
        supportCode: requestId,
        fieldErrors: exception.flatten().fieldErrors,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "object" && body !== null && "code" in body && "message" in body) {
        response.status(status).json({ ...body, supportCode: requestId });
        return;
      }
      response.status(status).json({
        code: `HTTP_${status}`,
        message: status >= 500 ? "Erro interno." : exception.message,
        supportCode: requestId,
      });
      return;
    }

    console.error(JSON.stringify({ event: "unhandled_api_error", requestId, error: exception instanceof Error ? exception.message : String(exception) }));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: "INTERNAL_ERROR",
      message: "Erro interno.",
      supportCode: requestId,
    });
  }
}

function getRequestId(request: Request): string {
  return String(request.headers["x-request-id"] ?? `rw-${Date.now().toString(36)}`);
}
