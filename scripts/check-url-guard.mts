/**
 * lib/url-guard.ts 纯函数直测（无测试框架，断言计数即退出码）
 * 运行：node scripts/check-url-guard.mts
 */
import { upstreamUrlError } from "../lib/url-guard.ts";

interface Case {
  url: string;
  /** 期望：true=应拒绝（返回非 null），false=应放行（返回 null） */
  block: boolean;
  note: string;
}

const CASES: Case[] = [
  // 应拒绝：私网/回环/元数据
  { url: "http://169.254.169.254/latest/meta-data", block: true, note: "云元数据地址" },
  { url: "http://10.0.0.1:8080/v1", block: true, note: "10/8 私网" },
  { url: "http://172.16.0.9/v1", block: true, note: "172.16/12 私网" },
  { url: "http://172.32.0.1/v1", block: false, note: "172.32 段不在 172.16/12 内" },
  { url: "http://192.168.1.1/v1", block: true, note: "192.168/16 私网" },
  { url: "http://127.0.0.1/v1", block: true, note: "回环" },
  { url: "http://0.1.2.3/v1", block: true, note: "0/8 保留段" },
  { url: "http://100.64.0.1/v1", block: true, note: "CGNAT 下界" },
  { url: "http://100.127.255.254/v1", block: true, note: "CGNAT 上界" },
  { url: "http://100.200.1.1/v1", block: false, note: "100.200 不在 CGNAT 内" },
  { url: "http://localhost/v1", block: true, note: "localhost" },
  { url: "http://api.localhost/v1", block: true, note: "*.localhost" },
  { url: "http://metadata.google.internal/v1", block: true, note: "GCP 元数据" },
  { url: "http://nas.local/v1", block: true, note: "*.local mDNS" },
  { url: "http://[::1]/v1", block: true, note: "IPv6 回环" },
  { url: "http://[::]/v1", block: true, note: "IPv6 未指定" },
  { url: "http://[fd00::1]/v1", block: true, note: "fc00::/7 ULA" },
  { url: "http://[fe80::1]/v1", block: true, note: "fe80::/10 链路本地" },
  { url: "http://[::ffff:127.0.0.1]/v1", block: true, note: "IPv4-mapped 点分" },
  { url: "http://[::ffff:7f00:1]/v1", block: true, note: "IPv4-mapped 十六进制" },
  { url: "ftp://example.com/v1", block: true, note: "非 http/https 协议" },
  { url: "file:///etc/passwd", block: true, note: "file 协议" },
  { url: "", block: true, note: "空串" },
  { url: "not a url", block: true, note: "无法解析" },
  // 应放行：合法公网/中继
  { url: "https://api.openai.com/v1", block: false, note: "官方 API" },
  { url: "https://api.example-relay.cn/v1", block: false, note: "普通中转域名" },
  { url: "http://8.8.8.8/v1", block: false, note: "公网 IP" },
  { url: "https://relay.example.com:8443/v1", block: false, note: "自定义端口" },
  { url: "https://172.32.0.1/v1", block: false, note: "公网段 172.32/12 之外" },
];

let failed = 0;
for (const c of CASES) {
  const err = upstreamUrlError(c.url);
  const blocked = err !== null;
  const pass = blocked === c.block;
  if (!pass) failed++;
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark} [${c.note}] ${c.url || "(空)"} → ${err ?? "放行"}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} 通过`);
if (failed > 0) process.exit(1);
