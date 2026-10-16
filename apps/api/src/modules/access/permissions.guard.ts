import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, NICHE_SECTIONS, SECTION_LABELS } from "@realwise/shared";
import { accessDenied } from "./access-errors";
import { hasCrfOnFile } from "./team-rules";
import { REQUIRE_CRF_KEY, REQUIRE_PERMISSION_KEY, type RequiredPermission } from "./permission.decorator";
import type { MemberContext } from "./member-context";

/**
 * Enforces @RequirePermission / @RequireCrf. Must run after BusinessSessionGuard, which resolves
 * req.member from the session cookie. A route without @RequirePermission is left open to any
 * authenticated member (use sparingly; /auth/me style routes).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRE_PERMISSION_KEY, targets);
    const needsCrf = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_CRF_KEY, targets);
    const req = context.switchToHttp().getRequest();
    const member: MemberContext | undefined = req.member;
    if (!member) {
      // Misconfiguration (guard order), fail closed.
      throw accessDenied("PERMISSION_DENIED", "Sem acesso.");
    }
    if (required && !required.sections.some((s) => hasPermission(member.permissions, s, required.level))) {
      // Report the alternative that exists in this member's niche (e.g. "farmacia" rather than "configuracoes").
      const first = required.sections.find((s) => NICHE_SECTIONS[member.niche].includes(s)) ?? required.sections[0];
      throw accessDenied(
        "PERMISSION_DENIED",
        `Você não tem acesso a "${SECTION_LABELS[first]}" (${required.level === "edit" ? "edição" : "visualização"}).`,
        { section: first, required: required.level },
      );
    }
    if (needsCrf && !(member.requiresCrf && hasCrfOnFile(member.crf))) {
      throw accessDenied(
        "CRF_REQUIRED",
        "Esta ação exige um farmacêutico com CRF cadastrado.",
        required ? { section: required.sections[0], required: required.level } : {},
      );
    }
    return true;
  }
}
