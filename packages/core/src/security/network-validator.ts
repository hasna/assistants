import { lookup as dnsLookup } from 'node:dns/promises';

type LookupFn = typeof dnsLookup;
let lookupFn: LookupFn = dnsLookup;

/**
 * Set a custom DNS lookup function (for testing)
 */
export function setDnsLookupForTests(fn?: LookupFn): void {
  lookupFn = fn ?? dnsLookup;
}

/**
 * Check if a hostname resolves to a private/internal IP (SSRF protection).
 * Fails closed on DNS errors to prevent bypass via DNS failures.
 */
export async function isPrivateHostOrResolved(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) {
    return true;
  }

  const host = normalizeHostname(hostname);
  if (host === '' || isIpLiteral(host)) {
    return isPrivateHost(host);
  }

  try {
    const results = await lookupFn(host, { all: true });
    for (const result of results) {
      if (isPrivateHost(result.address)) {
        return true;
      }
    }
    return false;
  } catch {
    // SECURITY: Fail-closed on DNS errors to prevent SSRF bypass via DNS failures
    // (e.g., attacker-controlled DNS returning SERVFAIL then resolving to internal IP)
    return true;
  }
}

/**
 * Check if a string looks like an IP literal (v4 or v6).
 */
export function isIpLiteral(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (including ::1, etc.)
  if (host.includes(':')) return true;
  return false;
}

/**
 * Normalize a hostname for comparison.
 */
export function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase().trim();
  // Strip port
  if (host.startsWith('[')) {
    const idx = host.indexOf(']:');
    if (idx > 0) host = host.slice(1, idx);
    else if (host.endsWith(']')) host = host.slice(1, -1);
  } else {
    const idx = host.lastIndexOf(':');
    const beforeColon = host.slice(0, idx);
    // If there's a port and before colon is not IPv6
    if (idx > 0 && !beforeColon.includes(':')) {
      host = beforeColon;
    }
  }
  // Strip trailing dot
  host = host.replace(/\.$/, '');
  return host;
}

/**
 * Check if a hostname is a private/internal address.
 */
export function isPrivateHost(hostname: string): boolean {
  let host = normalizeHostname(hostname);

  // Common private hostnames
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '127.0.0.1' || host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:0') return true;
  // Decimal IP (could be 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(host)) return true;

  // IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1)
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    if (mapped.includes('.')) {
      return isPrivateHost(mapped);
    }
    // Hex format like ::ffff:7f00:1
    const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexMatch) {
      const high = Number.parseInt(hexMatch[1], 16);
      const low = Number.parseInt(hexMatch[2], 16);
      const octets = [
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 8) & 0xff,
        low & 0xff,
      ];
      return isPrivateIPv4(octets);
    }
    return false;
  }

  // Pure IPv6 - just check for loopback
  if (host.includes(':')) {
    return host === '::1' || host === '::' || host === '0:0:0:0:0:0:0:0';
  }

  // IPv4 dotted-decimal
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const value = Number.parseInt(match[i], 10);
    if (Number.isNaN(value)) return false;
    octets.push(value);
  }

  return isPrivateIPv4(octets);
}

/**
 * Check if an IPv4 address (as octets) is private.
 */
export function isPrivateIPv4(octets: number[]): boolean {
  // 0.0.0.0/8 - "This" network
  if (octets[0] === 0) return true;
  // 10.0.0.0/8 - Private
  if (octets[0] === 10) return true;
  // 100.64.0.0/10 - Carrier-grade NAT
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  // 169.254.0.0/16 - Link-local
  if (octets[0] === 169 && octets[1] === 254) return true;
  // 192.168.0.0/16 - Private
  if (octets[0] === 192 && octets[1] === 168) return true;
  // 172.16.0.0/12 - Private
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  // 127.0.0.0/8 - Loopback
  if (octets[0] === 127) return true;
  // 224.0.0.0/4 - Multicast
  if (octets[0] >= 224 && octets[0] <= 239) return true;
  // 240.0.0.0/4 - Reserved
  if (octets[0] >= 240) return true;

  return false;
}
