/**
 * 上游 URL 基线防护（SSRF）
 *
 * 服务端会携带鉴权信息向 base/proxy 指定的主机发起请求，因此必须拒绝
 * 指向内网/回环/链路本地/云元数据地址的 URL：
 *  - scheme 仅允许 http/https
 *  - 拒绝 localhost / *.localhost / *.internal / *.local
 *  - 拒绝私网与保留段 IP 字面量：
 *      IPv4：0/8、10/8、127/8、169.254/16（链路本地，含云元数据）、
 *            172.16/12、192.168/16、100.64/10（CGNAT）
 *      IPv6：::、::1、fc00::/7（ULA）、fe80::/10（链路本地）、
 *            ::ffff: 映射的 IPv4（点分与十六进制两种形式）
 *
 * 已知边界（基线即如此，不构成完整 SSRF 防线）：
 *  - 不做 DNS 解析校验：公网域名解析到内网 IP（DNS rebinding）不在此防线内
 *  - 非标准 IPv4 字面量（十六进制段等）依赖 WHATWG URL 的规范化，
 *    规范化不了的按普通域名走 DNS（解析失败自然不可达）
 *
 * 返回 null 表示通过；返回字符串为拒因（可安全透出给调用方，不涉内部信息）。
 */
export function upstreamUrlError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "URL 为空";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "URL 无法解析";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `不允许的协议: ${url.protocol}`;
  }

  // WHATWG URL 对 IPv6 保留方括号（如 "[::1]"），IPv4 简写会被规范化为点分四段
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!host) return "URL 缺少主机名";

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return `禁止访问的内网主机: ${host}`;
  }

  const v4 = parseIpv4(host);
  if (v4) {
    return isPrivateIpv4(v4) ? `禁止访问的内网地址: ${host}` : null;
  }
  if (host.includes(":") && isPrivateIpv6(host)) {
    return `禁止访问的内网地址: ${host}`;
  }
  return null;
}

/** 点分四段解析（仅接受已由 URL 规范化的标准形式） */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

function isPrivateIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 "本网络"
  if (a === 10) return true; // 10/8 私网
  if (a === 127) return true; // 127/8 回环
  if (a === 169 && b === 254) return true; // 169.254/16 链路本地（云元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 私网
  if (a === 192 && b === 168) return true; // 192.168/16 私网
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // IPv4-mapped 点分形式：::ffff:127.0.0.1
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]);
    return !!v4 && isPrivateIpv4(v4);
  }
  const hextets = expandHextets(host);
  // 形似 IPv6 但解析不了：宁可错杀
  if (!hextets) return true;
  if (hextets.every((h) => h === 0)) return true; // :: 未指定地址
  if (
    hextets.slice(0, 7).every((h) => h === 0) &&
    hextets[7] === 1
  ) {
    return true; // ::1 回环
  }
  if (
    hextets.slice(0, 5).every((h) => h === 0) &&
    hextets[5] === 0xffff
  ) {
    // ::ffff:x:x 十六进制映射的 IPv4
    const v4: [number, number, number, number] = [
      hextets[6] >> 8,
      hextets[6] & 0xff,
      hextets[7] >> 8,
      hextets[7] & 0xff,
    ];
    return isPrivateIpv4(v4);
  }
  const first = hextets[0];
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 ULA
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 链路本地
  return false;
}

/** 展开 "::" 压缩为 8 个 hextet；非法返回 null */
function expandHextets(host: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(host)) return null;
  const sections = host.split("::");
  if (sections.length > 2) return null;
  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  if (sections.length === 1 && fill !== 0) return null;
  const all = [...left, ...Array<string>(Math.max(fill, 0)).fill("0"), ...right];
  if (all.length !== 8) return null;
  const out: number[] = [];
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  return out;
}
