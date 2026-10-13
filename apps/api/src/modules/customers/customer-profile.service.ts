import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  InvalidAddressNumberError,
  addressDiffersFromSaved,
  canonicalPhone,
  firstName,
  maskAddress,
  normalizeAddressNumber,
  normalizeCep,
  sameAddress,
  type AddressFields,
  type MaskedAddress,
} from "./address-utils";
import { CEP_LOOKUP, type CepLookupOutcome, type FallbackCepLookup } from "./cep-lookup";

export interface SaveAddressInput {
  cep: string;
  number: string;
  complement?: string | null;
  reference?: string | null;
  /** Only used when the CEP provider is unavailable (manual entry) or the CEP is generic (no street). */
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  /** The visitor explicitly chose "Atualizar endereço": the new address becomes the default. */
  replaceDefault?: boolean;
}

export interface SaveAddressResult {
  address: MaskedAddress;
  isDefault: boolean;
  /** true when an identical address was already saved (nothing new written). */
  reused: boolean;
  differsFromSaved: boolean;
  /** Full, unmasked snapshot to copy into Order.addressSnapshot (the visitor just typed it, so it is theirs to see). */
  snapshot: AddressFields;
}

function clean(v: string | null | undefined, max = 120): string | null {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : null;
}

@Injectable()
export class CustomerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CEP_LOOKUP) private readonly cep: FallbackCepLookup,
  ) {}

  lookupCep(cep: string): Promise<CepLookupOutcome> {
    return this.cep.lookup(cep);
  }

  /**
   * Phone-first recognition (web chat, number NOT verified): reveals only the first name and a
   * masked default address (street number hidden). Creates nothing.
   */
  async recognizeByPhone(businessId: string, phone: string) {
    const phoneNormalized = canonicalPhone(phone);
    if (!phoneNormalized) throw new BadRequestException("Telefone inválido.");
    const lead = await this.prisma.client.lead.findUnique({
      where: { businessId_phoneNormalized: { businessId, phoneNormalized } },
      select: { id: true, name: true },
    });
    if (!lead) return { recognized: false as const };
    const def = await this.getDefaultAddress(businessId, lead.id);
    return {
      recognized: true as const,
      firstName: firstName(lead.name),
      address: def ? maskAddress(def) : null,
    };
  }

  async getDefaultAddress(businessId: string, leadId: string) {
    return this.prisma.client.customerAddress.findFirst({
      where: { businessId, leadId, isDefault: true, supersededAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Masked view for the visitor (current default only). */
  async getMaskedDefault(businessId: string, leadId: string): Promise<MaskedAddress | null> {
    const def = await this.getDefaultAddress(businessId, leadId);
    return def ? maskAddress(def) : null;
  }

  /** Full history (newest first) for the owner dashboard; superseded entries are kept, never deleted. */
  async listForOwner(businessId: string, leadId: string) {
    return this.prisma.client.customerAddress.findMany({ where: { businessId, leadId }, orderBy: { createdAt: "desc" } });
  }

  /**
   * Saves an address entered by the visitor. NEVER overwrites the saved default silently:
   *  - identical to an existing entry -> reuse it (nothing written);
   *  - no default yet -> the new entry becomes the default;
   *  - a default exists -> the new entry is stored as non-default history unless `replaceDefault`
   *    (explicit "Atualizar endereço"), in which case the old default is superseded (kept as history).
   * The CEP is resolved server-side; client-sent street/district/city/state are only accepted when
   * the provider is unavailable or the CEP is generic.
   */
  async saveAddress(businessId: string, leadId: string, input: SaveAddressInput): Promise<SaveAddressResult> {
    const cep8 = normalizeCep(input.cep);
    if (!cep8) throw new BadRequestException("CEP inválido.");
    let number: string;
    try {
      number = normalizeAddressNumber(input.number);
    } catch (err) {
      if (err instanceof InvalidAddressNumberError) throw new BadRequestException(err.message);
      throw err;
    }

    const lookup = await this.cep.lookup(cep8);
    if (lookup.status === "not_found") throw new BadRequestException("CEP não encontrado.");
    const resolved = lookup.status === "ok" ? lookup.result : null;
    const street = clean(resolved?.street) ?? clean(input.street);
    const district = clean(resolved?.district) ?? clean(input.district);
    const city = clean(resolved?.city) ?? clean(input.city);
    const state = (clean(resolved?.state, 2) ?? clean(input.state, 2))?.toUpperCase() ?? null;
    if (!street || !city || !state || !district) {
      throw new BadRequestException({
        statusCode: 400,
        error: "Bad Request",
        code: lookup.status === "unavailable" ? "CEP_UNAVAILABLE" : "ADDRESS_INCOMPLETE",
        message: "Informe rua, bairro, cidade e estado.",
        missing: [!street && "street", !district && "district", !city && "city", !state && "state"].filter(Boolean),
      });
    }

    const fields: AddressFields = {
      cep: cep8,
      street,
      number,
      complement: clean(input.complement, 60),
      reference: clean(input.reference, 120),
      district,
      city,
      state,
    };

    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { id: true } });
    if (!lead) throw new ForbiddenException("Cliente não encontrado.");

    const current = await this.getDefaultAddress(businessId, leadId);
    const differsFromSaved = addressDiffersFromSaved(fields, current);

    const existing = await this.prisma.client.customerAddress.findMany({
      where: { businessId, leadId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const match = existing.find((a) => sameAddress(fields, a));
    if (match) {
      if (input.replaceDefault && !match.isDefault) {
        const promoted = await this.promote(businessId, leadId, match.id, current?.id);
        return { address: maskAddress(promoted), isDefault: true, reused: true, differsFromSaved, snapshot: fields };
      }
      return { address: maskAddress(match), isDefault: match.isDefault, reused: true, differsFromSaved, snapshot: fields };
    }

    const makeDefault = !current || input.replaceDefault === true;
    const created = await this.prisma.client.$transaction(async (tx) => {
      if (makeDefault && current) {
        await tx.customerAddress.update({ where: { id: current.id }, data: { isDefault: false, supersededAt: new Date() } });
      }
      return tx.customerAddress.create({
        data: { businessId, leadId, ...fields, complement: fields.complement ?? null, reference: fields.reference ?? null, isDefault: makeDefault },
      });
    });
    return { address: maskAddress(created), isDefault: makeDefault, reused: false, differsFromSaved, snapshot: fields };
  }

  private async promote(businessId: string, leadId: string, addressId: string, previousDefaultId?: string) {
    return this.prisma.client.$transaction(async (tx) => {
      if (previousDefaultId) {
        await tx.customerAddress.update({ where: { id: previousDefaultId }, data: { isDefault: false, supersededAt: new Date() } });
      }
      return tx.customerAddress.update({ where: { id: addressId }, data: { isDefault: true, supersededAt: null } });
    });
  }

  /** For order creation (wave 2): does this delivery address differ from the customer's saved default? */
  async differsFromSavedDefault(businessId: string, leadId: string, address: AddressFields): Promise<boolean> {
    const def = await this.getDefaultAddress(businessId, leadId);
    return addressDiffersFromSaved(address, def);
  }
}
