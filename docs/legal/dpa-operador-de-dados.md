<!-- RASCUNHO GERADO POR IA — NÃO PUBLICAR SEM REVISÃO DE ADVOGADO. Ver docs/legal/README.md. -->

# Contrato de Operação de Dados (DPA) — RealWise × Tenant

Rascunho estrutural. Define RealWise como **operador** e o Tenant (negócio contratante) como **controlador**, nos termos do art. 39 da LGPD.

## 1. Objeto

RealWise trata dados pessoais dos clientes do Tenant exclusivamente para prestar o serviço de atendimento automatizado contratado, conforme instruções documentadas do Tenant e os Termos de Serviço.

## 2. Obrigações do operador (RealWise)

- Tratar dados apenas conforme instruções do Tenant e a finalidade contratada.
- Garantir confidencialidade de quem acessa os dados.
- Adotar medidas de segurança técnicas e administrativas (criptografia em repouso, controle de acesso, log de auditoria).
- Notificar o Tenant em até [PRAZO, ex.: 24h] após identificar incidente de segurança que possa acarretar risco ou dano relevante.
- Auxiliar o Tenant no atendimento de direitos do titular (acesso, correção, exclusão, portabilidade).
- Excluir ou devolver os dados ao fim do contrato, salvo obrigação legal de retenção.

## 3. Subprocessadores autorizados

| Subprocessador | Finalidade | Localização |
|---|---|---|
| Hetzner Online GmbH | Hospedagem e infraestrutura de IA | Alemanha (UE) |
| Stripe | Processamento de pagamentos | EUA/UE (certificações próprias) |
| [Provedor de API gerenciada] | Failover de inferência de IA | A definir |

O Tenant autoriza o uso dos subprocessadores acima. Qualquer novo subprocessador será comunicado com antecedência mínima de [PRAZO].

## 4. Transferência internacional

Dados hospedados na União Europeia (Hetzner, Alemanha). RealWise declara adotar salvaguardas compatíveis com o art. 33 da LGPD para qualquer transferência internacional decorrente do uso de subprocessadores.

## 5. Dados sensíveis

Em nichos que envolvem documentos sensíveis (ex.: comprovante de renda, documento de identidade em locação imobiliária), aplica-se consentimento específico e destacado do Visitante, conforme art. 11 da LGPD, com retenção reduzida e descrita na Política de Privacidade.

## 6. Vigência e responsabilidade

Este DPA vigora enquanto durar o contrato de assinatura entre as partes. Responsabilidades e eventuais indenizações seguem o regime do art. 42 da LGPD e o quanto pactuado nos Termos de Serviço.

---
**Nota interna:** rascunho gerado com apoio do skill `lgpd-skills` (sub-skill `lgpd-dpa`). Revisar com advogado antes de anexar a qualquer contrato real. Campos entre colchetes precisam ser definidos.
