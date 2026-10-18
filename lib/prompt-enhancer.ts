/**
 * 提示词本地扩写（纯函数：不联网、不耗额度、确定性可直测）
 *
 * 做什么：把用户手输的短提示词，按识别出的题材补上「光影 / 镜头构图 / 氛围色调 / 质感细节」
 * 四个维度的**描述性短语**。产出是成句的描述而不是标签堆砌——上游是 gpt-image 系模型，
 * 「柔和侧逆光勾勒轮廓，85mm 浅景深虚化背景」这类描述比「8K, 超精细, 大师作品」更有效。
 *
 * 三条不变量（改数据时务必保持）：
 *  1. 只补「表现手法」，不发明「画面内容」：不替用户加主体属性、道具、场景元素
 *     （用户说「一只猫」就只谈光/镜头/色调/质感，不能擅自把它变成「橘猫坐在窗台」）；
 *  2. 用户已在某维度写过要求（如已有「逆光」），该维度整体跳过——不掺和、不矛盾；
 *  3. 纯函数、确定性：同 (输入, variant) 必得同结果；对自身输出幂等（再点一次不会翻倍）。
 */

// ============================================================
// 题材短语库
// ============================================================

/** 四个维度 + 可选风格。每个维度 1~2 条候选，按 variant 轮换（连点两次得到不同版本） */
interface Pack {
  lighting: string[];
  lens: string[];
  tone: string[];
  texture: string[];
  /** 仅风格主导的题材（插画/奇幻等）用；写实题材留空，避免把写实带偏 */
  style?: string[];
}

export type Genre =
  | "art"
  | "scifi"
  | "fantasy"
  | "stilllife"
  | "portrait"
  | "landscape"
  | "city"
  | "default";

type CategoryKey = "lighting" | "lens" | "tone" | "texture" | "style";

/**
 * 题材判定规则：按数组顺序**命中即返回**（前面的更"风格主导"，优先级更高）。
 * 例：「动漫风格的人物插画」同时命中 art(插画/动漫) 与 portrait(人物)，按顺序取 art 才对。
 * ASCII 关键词按词边界匹配，CJK 关键词按子串匹配（见 hitsKeyword）。
 */
const GENRE_RULES: { genre: Genre; keywords: string[] }[] = [
  {
    genre: "art",
    keywords: [
      "插画", "动漫", "二次元", "漫画", "卡通", "吉卜力", "像素", "水彩", "水墨", "国风",
      "油画", "素描", "线稿", "手绘", "版画", "绘本", "古风", "赛璐璐", "涂鸦",
      "anime", "manga", "cartoon", "ghibli", "illustration", "watercolor", "pixel art",
      "comic", "sketch", "drawing", "cel-shading",
    ],
  },
  {
    genre: "scifi",
    keywords: [
      "赛博", "朋克", "未来", "科幻", "机甲", "太空", "星际", "星舰", "飞船", "机器人",
      "全息", "霓虹", "废土", "反乌托邦", "空间站", "航天",
      "cyberpunk", "sci-fi", "scifi", "futuristic", "neon", "mecha", "spaceship",
      "starship", "android", "robot", "hologram", "dystopian",
    ],
  },
  {
    genre: "fantasy",
    keywords: [
      "奇幻", "魔法", "魔幻", "梦境", "超现实", "精灵", "城堡", "神话", "异世界", "仙侠",
      "天使", "恶魔", "炼金", "巨龙", "龙族", "神龙",
      "fantasy", "magic", "magical", "dreamlike", "surreal", "elf", "castle", "myth",
      "dragon", "sorcerer", "ethereal", "otherworldly",
    ],
  },
  {
    genre: "stilllife",
    keywords: [
      "产品", "商品", "海报", "电商", "主图", "包装", "广告", "静物", "美食", "食物",
      "甜品", "蛋糕", "咖啡", "料理", "饮料", "菜单", "摆盘", "香水", "护肤", "化妆品",
      "珠宝", "首饰", "手表",
      "product", "e-commerce", "ecommerce", "packaging", "advertisement", "still life",
      "food", "dessert", "cake", "coffee", "cuisine", "perfume", "cosmetics", "jewelry",
    ],
  },
  {
    genre: "portrait",
    keywords: [
      "人像", "肖像", "人物", "女孩", "男孩", "少女", "少年", "女人", "男人", "女性",
      "男性", "美女", "帅哥", "写真", "自拍", "模特", "头像", "全身", "半身", "老人",
      "儿童", "婴儿", "孕妇", "猫咪", "猫", "狗", "宠物", "动物", "兔子", "老虎", "狮子",
      "portrait", "headshot", "selfie", "model", "woman", "man", "girl", "boy", "person",
      "face", "people", "cat", "dog", "pet", "animal", "rabbit", "tiger", "bird",
      "child", "baby",
    ],
  },
  {
    genre: "landscape",
    keywords: [
      "风景", "山", "海边", "大海", "海洋", "海浪", "森林", "树林", "草原", "沙漠",
      "雪山", "雪景", "湖泊", "湖水", "瀑布", "峡谷", "星空", "银河", "日落", "日出",
      "夕阳", "朝霞", "晚霞", "云海", "花海", "田野", "稻田", "极光", "冰川", "火山",
      "岛屿", "沙滩", "溪流", "河流", "田园",
      "landscape", "mountain", "forest", "beach", "ocean", "sea", "desert", "lake",
      "waterfall", "canyon", "galaxy", "milky way", "sunset", "sunrise", "aurora",
      "glacier", "volcano", "island", "meadow", "jungle", "rainforest", "wilderness",
    ],
  },
  {
    genre: "city",
    keywords: [
      "城市", "都市", "街", "建筑", "大楼", "高楼", "楼宇", "巷", "弄堂", "胡同",
      "夜景", "公路", "马路", "广场", "地铁", "车站", "机场", "室内", "房间", "卧室",
      "客厅", "厨房", "书房", "办公室", "商场", "店铺", "书店", "教室", "酒店",
      "天际线", "桥", "港口", "码头", "屋顶", "阳台",
      "city", "urban", "street", "building", "architecture", "skyline", "alley", "road",
      "highway", "interior", "room", "bedroom", "living room", "office", "restaurant",
      "subway", "station", "airport", "mall", "shop", "bridge", "harbor", "rooftop",
      "balcony", "downtown",
    ],
  },
];

const ZH_PACKS: Record<Genre, Pack> = {
  art: {
    lighting: [
      "光线柔和通透，画面整体明快",
      "光影分区清晰，明暗对比克制不脏",
    ],
    lens: [
      "主体居中构图，画面留白得当",
      "前中后景层次分明，视觉引导线指向主体",
    ],
    tone: [
      "配色和谐统一，主色与点缀色对比明确",
      "色彩层次丰富，渐变过渡细腻",
    ],
    texture: [
      "线条流畅干净，笔触细节清晰",
      "画面细节丰富，纹理与笔触质感统一",
    ],
    style: [
      "整体画风统一，画面完成度高",
      "风格化处理克制，细节与整体氛围协调",
    ],
  },
  scifi: {
    lighting: [
      "霓虹灯牌的光晕在雾气中扩散，冷蓝与品红双色调打光",
      "强烈的体积光与边缘光，明暗关系戏剧化",
    ],
    lens: [
      "广角低角度仰拍，强调空间的巨大尺度与压迫感",
      "电影感宽银幕构图，主体落在画面三分点",
    ],
    tone: [
      "高对比度的赛博色调，暗部细节保留完整",
      "冷峻的未来主义色调，点缀少量高饱和光点",
    ],
    texture: [
      "金属与镜面材质反射周围光影，细节精密",
      "湿滑地面的反光与全息投影细节清晰可见",
    ],
  },
  fantasy: {
    lighting: [
      "神秘的环境光从画面深处透出，光晕柔和扩散",
      "强烈的边缘光与体积光，营造超现实的明暗关系",
    ],
    lens: [
      "主体居中构图，视线向画面深处延伸，空间感强烈",
      "电影感景深控制，前后景虚实层次分明",
    ],
    tone: [
      "梦幻的冷紫与暖金交织色调，氛围感强烈",
      "低饱和度的高级色调，神秘而克制",
    ],
    texture: [
      "材质细节丰富，云雾与光尘颗粒清晰可见",
      "画面层次深邃，细节繁复但秩序清晰",
    ],
  },
  stilllife: {
    lighting: [
      "柔光箱布光，光线均匀柔和，高光过渡细腻",
      "侧逆光勾勒边缘轮廓，主体与背景层次分离",
    ],
    lens: [
      "微距镜头拍摄，浅景深突出主体细节",
      "俯视平铺构图，画面整洁有序，商业感强",
    ],
    tone: [
      "干净纯粹的整体色调，背景简洁不抢主体",
      "温暖诱人的色调，主体质感突出",
    ],
    texture: [
      "表面质感真实，材质的反射与细节清晰",
      "细节锐利，微小的肌理与纹路清晰可辨",
    ],
  },
  portrait: {
    lighting: [
      "柔和的侧逆光勾勒出轮廓边缘光，面部过渡自然",
      "柔和的窗光从侧前方照亮主体，明暗过渡细腻",
    ],
    lens: [
      "85mm 人像镜头拍摄，浅景深虚化背景，主体清晰锐利",
      "中长焦人像视角，背景柔和虚化，眼神光清晰可见",
    ],
    tone: [
      "整体色调温暖自然，过渡柔和通透",
      "低饱和的柔和色调，氛围安静耐看",
    ],
    texture: [
      "细节丰富，毛发与皮肤质感真实细腻",
      "材质纹理清晰可辨，层次过渡丰富",
    ],
  },
  landscape: {
    lighting: [
      "黄金时段的低角度阳光斜照，光影层次丰富",
      "云层缝隙透出的柔和天光，明暗过渡自然",
    ],
    lens: [
      "广角镜头大景深拍摄，前景到远景都清晰",
      "长焦压缩空间层次，画面纵深感强烈",
    ],
    tone: [
      "整体色调清新通透，天空色彩层次丰富",
      "自然饱和度适中的色调，氛围宁静辽阔",
    ],
    texture: [
      "植被与岩石的地表纹理细节丰富",
      "空气通透，远景细节清晰可辨",
    ],
  },
  city: {
    lighting: [
      "天光与人工照明交织，明暗层次分明",
      "柔和的环境光均匀铺陈，高光与暗部细节保留完整",
    ],
    lens: [
      "低角度广角仰拍，强化线条与透视纵深",
      "中焦段平视视角，画面结构稳定，透视自然",
    ],
    tone: [
      "冷暖对比鲜明的色调，都市氛围感强烈",
      "低饱和的高级灰调，整体氛围克制现代",
    ],
    texture: [
      "墙面与玻璃的材质纹理清晰，反光细节真实",
      "细节丰富，接缝与材质肌理清晰可辨",
    ],
  },
  default: {
    lighting: [
      "柔和的自然光照亮主体，明暗过渡自然",
      "侧光塑造立体感，高光与暗部层次分明",
    ],
    lens: [
      "中焦段视角拍摄，主体突出，构图均衡",
      "浅景深虚化背景，视线自然聚焦于主体",
    ],
    tone: [
      "整体色调统一协调，氛围自然",
      "色彩层次丰富，冷暖对比适度",
    ],
    texture: [
      "细节丰富，质感真实细腻",
      "画面清晰锐利，材质纹理清晰可辨",
    ],
  },
};

const EN_PACKS: Record<Genre, Pack> = {
  art: {
    lighting: [
      "soft, even light keeping the whole image bright and readable",
      "clear light-and-shadow zoning with crisp separation",
    ],
    lens: [
      "centered composition with generous negative space",
      "layered foreground, midground and background leading the eye to the subject",
    ],
    tone: [
      "harmonious palette with a clear main color and accent colors",
      "rich color layering with smooth gradients",
    ],
    texture: [
      "clean flowing lines with crisp brushwork",
      "detailed rendering with consistent texture and brushwork",
    ],
    style: [
      "a single coherent art style carried through the whole image",
      "restrained stylization that stays consistent with the overall mood",
    ],
  },
  scifi: {
    lighting: [
      "neon signage blooming through rain and haze, teal and magenta key light",
      "strong volumetric light and rim lighting with dramatic contrast",
    ],
    lens: [
      "low-angle wide shot emphasizing the enormous scale of the environment",
      "cinematic widescreen framing with the subject on a third",
    ],
    tone: [
      "high-contrast cyber palette with detail preserved in the shadows",
      "cold futuristic grading with a few saturated light accents",
    ],
    texture: [
      "metal and glass surfaces reflecting the surrounding light",
      "wet-ground reflections and holographic detail",
    ],
  },
  fantasy: {
    lighting: [
      "mysterious ambient light glowing from deep inside the frame",
      "strong rim and volumetric light creating surreal contrast",
    ],
    lens: [
      "centered composition drawing the eye deep into the scene",
      "cinematic depth of field with layered foreground and background",
    ],
    tone: [
      "dreamlike palette blending cool violet and warm gold",
      "desaturated high-end grading, mystical and restrained",
    ],
    texture: [
      "rich material detail with drifting mist and light motes",
      "deep layered detail that still reads clearly",
    ],
  },
  stilllife: {
    lighting: [
      "softbox lighting with even illumination and smooth highlights",
      "rim light separating the subject from the background",
    ],
    lens: [
      "macro lens with shallow depth of field isolating key detail",
      "overhead flat-lay framing with a clean, commercial composition",
    ],
    tone: [
      "clean, neutral palette with an uncluttered background",
      "warm inviting tone with pronounced material quality",
    ],
    texture: [
      "true surface texture with realistic reflections",
      "sharp detail showing fine grain and pattern",
    ],
  },
  portrait: {
    lighting: [
      "soft rim light outlining the subject with natural facial falloff",
      "gentle window light from the side with smooth tonal transitions",
    ],
    lens: [
      "shot on an 85mm portrait lens with shallow depth of field and a softly blurred background",
      "medium-telephoto perspective, creamy background bokeh and a clear catchlight in the eyes",
    ],
    tone: [
      "warm natural color grading with true-to-life skin tones",
      "muted, soft palette with a calm and timeless mood",
    ],
    texture: [
      "fine, realistic detail across hair, skin and fabric",
      "crisp micro-detail with smooth tonal gradients",
    ],
  },
  landscape: {
    lighting: [
      "low golden-hour sunlight raking across the scene with rich shadow detail",
      "soft diffused daylight breaking through the clouds",
    ],
    lens: [
      "wide-angle lens with deep focus, sharp from foreground to far distance",
      "telephoto compression that layers the scene with strong depth",
    ],
    tone: [
      "clean, airy palette with layered sky tones",
      "natural, moderately saturated colors with a serene, expansive mood",
    ],
    texture: [
      "rich texture in vegetation, rock and terrain",
      "clear atmospheric depth with readable distant detail",
    ],
  },
  city: {
    lighting: [
      "a mix of daylight and artificial light with clear highlight and shadow separation",
      "soft ambient light holding detail in both highlights and shadows",
    ],
    lens: [
      "low-angle wide shot emphasizing architectural lines and perspective",
      "medium focal length at eye level with stable, natural perspective",
    ],
    tone: [
      "cool-warm contrast with a strong urban mood",
      "desaturated high-end gray palette, restrained and modern",
    ],
    texture: [
      "visible material texture in walls and glass with realistic reflections",
      "crisp detail and clean surface texture",
    ],
  },
  default: {
    lighting: [
      "soft natural light on the subject with smooth falloff",
      "side light shaping volume with clear highlights and shadows",
    ],
    lens: [
      "medium focal length, balanced composition with a clear subject",
      "shallow depth of field pulling focus to the subject",
    ],
    tone: [
      "coherent, natural color balance",
      "rich color with a moderate warm-cool contrast",
    ],
    texture: [
      "fine detail and realistic material quality",
      "crisp and sharp with readable texture",
    ],
  },
};

// ============================================================
// 维度跳过词：用户已提到该维度 → 整段不补（避免"已写逆光又补柔光"的矛盾）
// ============================================================
const ZH_SKIP: Record<CategoryKey, string[]> = {
  // 时段词同样意味着"光已定"：「夕阳下的海边」再补「黄金时段阳光斜照」就是重复甚至打架。
  // 注意「霓虹」不在列：它只是光源种类，补上光晕扩散/双色调打光属于增益而非打架。
  lighting: [
    "光", "灯", "照明", "打光", "夕阳", "日落", "日出", "黄昏", "黎明", "清晨",
    "夜景", "月夜",
  ],
  lens: [
    "镜头", "焦段", "景深", "虚化", "广角", "长焦", "微距", "特写", "构图", "视角",
    "俯拍", "仰拍", "透视", "角度",
  ],
  tone: ["色调", "氛围", "色彩", "配色", "饱和", "冷调", "暖调"],
  texture: ["质感", "细节", "材质", "纹理", "肌理"],
  style: ["风格", "画风", "流派"],
};

const EN_SKIP: Record<CategoryKey, string[]> = {
  lighting: [
    "light", "lit", "lamp", "illuminat", "sunset", "sunrise", "golden hour", "backlit",
    "night", "dusk", "dawn", "moonlight",
  ],
  lens: [
    "lens", "focal", "depth of field", "dof", "bokeh", "wide-angle", "wide angle",
    "telephoto", "macro", "close-up", "closeup", "composition", "angle", "framing",
    "perspective", "shot",
  ],
  tone: ["color", "colour", "palette", "tone", "mood", "atmosphere", "saturation", "grading"],
  texture: ["texture", "detail", "material", "grain", "finish"],
  style: ["style", "artstyle", "aesthetic"],
};

/** 追加顺序即优先级：靠前的先补，超长时先丢靠后的维度 */
const CATEGORY_ORDER: CategoryKey[] = ["lighting", "lens", "tone", "texture", "style"];

/**
 * 长度预算（按语言分档：英文单位字符承载的信息更少，同样字数下其实更短）：
 * - base：超过此长度视为「用户已经写得很细」，不再注水（added=0）
 * - total：追加过程中整段上限，超出就丢靠后的维度
 */
const LIMITS = {
  zh: { base: 240, total: 400 },
  en: { base: 400, total: 650 },
} as const;

// ============================================================
// 工具
// ============================================================

/** 含中文即按中文处理（中英混排提示词按中文补，输出更贴合用户语感） */
function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/**
 * 关键词命中判定：
 * - CJK 关键词子串命中（「街」命中「街拍」「街道」）
 * - ASCII 关键词按词边界命中，避免 cat 命中 category
 */
function hitsKeyword(text: string, kw: string): boolean {
  if (/^[\x20-\x7e]+$/.test(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return text.includes(kw);
}

/** 题材识别：按 GENRE_RULES 顺序命中即返回，都不中则 default */
export function detectGenre(text: string): Genre {
  for (const rule of GENRE_RULES) {
    if (rule.keywords.some((kw) => hitsKeyword(text, kw))) return rule.genre;
  }
  return "default";
}

export interface EnhanceResult {
  /** 扩写结果；无可补充时原样返回输入（已 trim） */
  text: string;
  /** 本次追加的短语条数（0 = 没有可补充的维度） */
  added: number;
  /** 识别出的题材（便于调试与后续切换策略） */
  genre: Genre;
}

/**
 * 扩写提示词。
 * @param input   用户输入
 * @param variant 版本号：每次点击递增，用于在候选短语间轮换（连点两次得到不同版本）
 */
export function enhancePrompt(input: string, variant = 0): EnhanceResult {
  const base = input.trim().replace(/\s+/g, " ");
  if (!base) return { text: "", added: 0, genre: "default" };

  const zh = hasCJK(base);
  const packs = zh ? ZH_PACKS : EN_PACKS;
  const skip = zh ? ZH_SKIP : EN_SKIP;
  const sep = zh ? "，" : ", ";

  const genre = detectGenre(base);
  const pack = packs[genre];
  const lower = base.toLowerCase();
  const limit = zh ? LIMITS.zh : LIMITS.en;

  // 用户已经写得很细了，再补就是注水
  if (base.length >= limit.base) return { text: base, added: 0, genre };

  const pieces: string[] = [];
  let length = base.length;

  for (const key of CATEGORY_ORDER) {
    const list = pack[key];
    if (!list || list.length === 0) continue;
    // 该维度用户已自己写过了，跳过
    if (skip[key].some((k) => lower.includes(k))) continue;
    const phrase = list[variant % list.length];
    if (length + sep.length + phrase.length > limit.total) continue;
    pieces.push(phrase);
    length += sep.length + phrase.length;
  }

  if (pieces.length === 0) return { text: base, added: 0, genre };
  return { text: base + sep + pieces.join(sep), added: pieces.length, genre };
}
