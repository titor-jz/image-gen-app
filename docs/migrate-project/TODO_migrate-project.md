# TODO - 椤圭洰杩佺Щ寰呭姙浜嬮」

> 鏈枃妗ｅ垪鍑鸿縼绉昏繃绋嬩腑閬楃暀鐨勫緟鍔炰簨椤癸紝浠ュ強鎮ㄩ渶瑕佹墜鍔ㄥ鐞嗙殑浜嬮」銆?
## 1. 绱ф€ュ緟鍔烇紙寤鸿绔嬪嵆澶勭悊锛?
### 1.1 鍦ㄦ柊浣嶇疆瀹夎渚濊禆
- 鐘舵€侊細寰呮墽琛?- 鍘熷洜锛氳縼绉绘椂鏈縼绉?node_modules
- 鎿嶄綔锛?  ```
  cd D:\jz\image-gen-app
  npm install
  ```
- 棰勪及鏃堕棿锛?-10 鍒嗛挓

### 1.2 楠岃瘉椤圭洰鍙繍琛?- 鐘舵€侊細寰呮墽琛?- 鎿嶄綔锛?  ```
  cd D:\jz\image-gen-app
  npm run dev
  ```
- 棰勬湡锛氬紑鍙戞湇鍔″櫒鍦?http://localhost:3000 鍚姩

## 2. 婧愮洰褰曠┖澹虫竻鐞?
### 鍒犻櫎琚攣瀹氱殑绌虹洰褰?d:\jz\project\image-gen-app
- 鐘舵€侊細寰呯敤鎴峰鐞?- 鍘熷洜锛氭簮鐩綍宸茶娓呯┖锛屼絾 Windows 鎸佹湁绯荤粺绾у彞鏌勬棤娉曠洿鎺ュ垹闄?- 瑙ｅ喅鏂规锛堜换閫夊叾涓€锛夛細

  鏂规 A锛氶噸鍚悗鍒犻櫎锛堟渶绠€鍗曪級
  1. 閲嶅惎 Windows
  2. 鍒犻櫎 d:\jz\project\image-gen-app

  鏂规 B锛氫娇鐢?Sysinternals handle.exe
  1. 涓嬭浇 handle.exe: https://learn.microsoft.com/en-us/sysinternals/downloads/handle
  2. 绠＄悊鍛?PowerShell 鎵ц锛歨andle.exe d:\jz\project\image-gen-app
  3. 鎵惧埌鍗犵敤杩涚▼ PID锛屽叧闂杩涚▼
  4. 鍒犻櫎鐩綍

  鏂规 C锛氱瓑寰呭彞鏌勮嚜鐒堕噴鏀?  - 鍏抽棴鎵€鏈夊彲鑳藉崰鐢ㄨ鐩綍鐨勭▼搴忥紙IDE銆佺紪杈戝櫒銆佺粓绔級

- 椋庨櫓璇勪及锛氫綆锛屾簮鐩綍宸叉棤鍐呭

## 3. 閰嶇疆绫诲緟鍔?
### 3.1 鏇存柊 IDE/缂栬緫鍣ㄩ」鐩矾寰?- 鍦?TRAE IDE / VS Code 涓皢鎵撳紑鐨勯」鐩粠 d:\jz\project\image-gen-app 鏀逛负 D:\jz\image-gen-app

### 3.2 妫€鏌?.env 鏂囦欢
- 婧愰」鐩湭鍙戠幇 .env / .env.local
- .env.example 鍜?.env.local.example 宸茶縼绉?- 濡傞渶瑕佷娇鐢?API 瀵嗛挜锛屽湪鏂颁綅缃垱寤?.env.local

## 4. 澶囦唤绠＄悊

### 澶囦唤淇濈暀鏈?- 浣嶇疆锛欴:\jz\.backup\image-gen-app-20260708-223447锛?.05 GB锛?- 寤鸿锛氫繚鐣?7 澶╁悗涓旈」鐩繍琛屾甯革紝鍙墜鍔ㄥ垹闄?- 鍒犻櫎鍛戒护锛?  ```
  Remove-Item -LiteralPath "D:\jz\.backup\image-gen-app-20260708-223447" -Recurse -Force
  ```

## 5. 鏁呴殰鎺掓煡

### 5.1 npm install 澶辫触
- 妫€鏌ョ綉缁?- 妫€鏌?package-lock.json锛堝凡楠岃瘉 SHA256 涓€鑷达級
- 鍒犻櫎 package-lock.json 鍚庨噸鏂?npm install

### 5.2 Git 鐘舵€佸紓甯?```
cd D:\jz\image-gen-app
git status
git fsck
```

### 5.3 濡傞渶鍥炴粴鍒板師浣嶇疆
```
robocopy "D:\jz\.backup\image-gen-app-20260708-223447" "d:\jz\project\image-gen-app" /MIR
```

## 6. 鍏抽敭璺緞閫熸煡

| 鐢ㄩ€?| 璺緞 |
|------|------|
| 鏂伴」鐩牴鐩綍 | D:\jz\image-gen-app |
| 杩佺Щ鏂囨。 | D:\jz\image-gen-app\docs\migrate-project\ |
| 杩佺Щ鑴氭湰 | D:\jz\image-gen-app\scripts\migrate\ |
| 瀹屾暣澶囦唤 | D:\jz\.backup\image-gen-app-20260708-223447 |
| 婧愮┖澹筹紙寰呮竻鐞嗭級 | d:\jz\project\image-gen-app |