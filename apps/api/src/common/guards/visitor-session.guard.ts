import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { verifyVisitorSession } from "@realwise/auth";
import { randomUUID } from "crypto";

@Injectable()
export class VisitorSessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.rw_visitor_session;
    if (token) {
      try {
        req.visitor = await verifyVisitorSession(token);
        return true;
      } catch {
        // falls through to anonymous
      }
    }
    req.visitor = { visitorToken: randomUUID() };
    return true;
  }
}
