import { describe, it, expect } from 'vitest';
import {
  parseX509Validity,
  computeCertificateFingerprint,
} from '../web/src/lib/c2paVerifier';

// RSA 1024 self-signed test certificate: CN=Test C2PA Issuer, O=Test Org
// Valid from 2026-09-21 to 2027-09-21 (UTC).
const TEST_CERT_HEX =
  '308201d33082013c020900a9d6ae4d241b923f300d06092a864886f70d01010b0500302e3119301706035504030c10546573742043325041204973737565723111300f060355040a0c0854657374204f7267301e170d3236303932313037313033375a170d3237303932313037313033375a302e3119301706035504030c10546573742043325041204973737565723111300f060355040a0c0854657374204f726730819f300d06092a864886f70d010101050003818d0030818902818100b767263164c631555576a944cca557e8f19d01f17cc78c39c37040488a1e77d27379bff3be0e7b271c40168ebc2d6fefbff10bff2bd1ec98a3b612543b07ed06ab45d076d3e94d9bbd8ba9ac2bd5b8dbc09216fa654fef18ec1c42f044dce297b632ba1039c034b1e73c9814cbaa8b5e32da3d44b7e363f602683f9ea054236d0203010001300d06092a864886f70d01010b0500038181000d18a39416fdaf3ef280419097820de95fb3b2d0609db6d546f613832b4b98e7c4cfdc49e492863bc35d8defda517c616f0f934850837694f9b62e48f006bb80bd83c98e809b1c296835703ac919ea6957c766b304e2edfaeeb80d264e24910256a0c93626e4ccccf6f23c5a4560cf16154da21791c798ebabece6e10eea44f9';

const certBytes = new Uint8Array(
  TEST_CERT_HEX.match(/.{2}/g)!.map((b) => parseInt(b, 16))
);

describe('c2paVerifier certificate helpers', () => {
  it('parses X.509 validity period', () => {
    const validity = parseX509Validity(certBytes);
    expect(validity).not.toBeNull();
    expect(validity!.notBefore.toISOString()).toBe('2026-09-21T07:10:37.000Z');
    expect(validity!.notAfter.toISOString()).toBe('2027-09-21T07:10:37.000Z');
  });

  it('computes SHA-256 certificate fingerprint', async () => {
    const fp = await computeCertificateFingerprint(certBytes);
    expect(fp).toHaveLength(64);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
