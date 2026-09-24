import { NextResponse } from "next/server";
import { getSamlConfig, samlClient, spEntityId, acsUrl } from "@/lib/saml";

/** SP metadata for the IdP (PingFederate / PingOne: "import metadata from URL"). */
export async function GET() {
  const cfg = await getSamlConfig();
  const xml = cfg
    ? samlClient(cfg).generateServiceProviderMetadata(null, null)
    : // Before the IdP is configured the SP side is still known: entity ID + ACS
      `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId()}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAssertionsSigned="true">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl()}" index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  return new NextResponse(xml, { headers: { "Content-Type": "application/samlmetadata+xml" } });
}
