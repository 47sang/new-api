# 10 · 缓存体系:两级缓存的分层、同步与一致性权衡

> 一句话定位:本篇拆解 new-api 的缓存全貌——什么数据放在哪一层、靠什么机制保持新鲜、多节点部署时接受多大的不一致窗口;读完你能掌握「定时全量重建 / 写时主动失效 / 读时水合」三种更新策略的真实取舍,并能把这套思路迁移到 Java 的 `Caffeine` + `Redis` 项目里。

## 🎯 本篇你将学到

- 为什么开启 `RedisEnabled` 会强制把 `MemoryCacheEnabled` 也置为 `true`(main.go:82-85),以及这背后的「按实体分家」而非经典一级二级关系。
- 渠道、能力、用户、令牌、动态配置、定价分别走哪套缓存,键与过期时间各是多少。
- `SyncChannelCache` / `SyncOptions` 的定时全量重建如何做到读路径无阻塞。
- 令牌与用户缓存如何用「栅栏(fence)+ 版本地板」阻止旧快照回写,这是全文最精妙的一段。
- 余额预扣为什么发生在缓存侧,而不是数据库侧。
- 本项目没有用 singleflight(请求合并),它靠什么替代。

## 🧠 核心概念

先纠正一个容易想当然的认知:这里的「两级」**不是** `Caffeine`(一级、进程内)→ `Redis`(二级、共享)逐级回源的链式结构。new-api 的做法是**按数据实体分工**:

| 数据 | 存储位置 | 新鲜机制 | Java 类比 |
| --- | --- | --- | --- |
| 渠道 + 能力(路由依据) | 进程内三个 `map` | 每 `SyncFrequency` 秒全量重建 | `@Scheduled` + 重建快照后原子替换 |
| 动态配置 `Option` | 进程内 `OptionMap` | 每 `SyncFrequency` 秒轮询 | `@Scheduled` 刷新的 `ConcurrentHashMap` |
| 定价 `pricingMap` | 进程内 | 1 分钟惰性过期 + 主动失效 | 双重检查锁(DCL)+ `refreshAfterWrite` |
| 用户 / 令牌 | `Redis` 哈希 | 写时失效 + 读时水合 | `RedisTemplate` `opsForHash` + cache-aside |
| 订阅计划 / 渠道亲和 | `cachex.HybridCache`:开 `Redis` 用 `Redis`,否则用 `hot.HotCache` | 写时失效 + 读时水合 | `RedisCacheManager` / `CaffeineCacheManager` 二选一 |

为什么要这样分?看访问频率和变更语义:

- **渠道 / 能力**:每个中继请求都要查「这个分组下这个模型有哪些可用渠道」,频率极高;但数据量小(几千行以内)、变更低频(管理员操作或自动禁用)。全量拉进进程内存,路由决策就是纯内存计算,一次数据库都不碰。
- **用户 / 令牌**:同样每个请求都要读,但**余额会高频变化**,且多节点部署时必须共享真相——进程内存做不到跨节点,所以放到 `Redis` 哈希里。
- **动态配置**:量极小,进程内存即可,一致性要求是「几十秒内最终一致」。

所以 `RedisEnabled` 强制 `MemoryCacheEnabled=true` 的原因就清楚了(main.go:82-85,注释写着「为了兼容旧版本」):渠道路由数据**只存在于进程内存**,如果只开 `Redis` 不开内存缓存,每个请求照样打数据库,`Redis` 对最热的那部分数据形同虚设。这个开关组合本质是历史演进的产物——内存缓存是路由快路径的地基,`Redis` 只是叠加在它之上的跨节点层。

## 🔍 源码剖析

### 1️⃣ 渠道与能力:进程内快照,定时全量重建

`model/channel_cache.go:20-25` 声明了三张全局表,由一把读写锁保护:

```go
var group2model2channels map[string]map[string][]int // 启用渠道:分组 → 模型 → 渠道ID列表
var channelsIDM map[int]*Channel                     // 全量渠道(含禁用)
var channel2advancedCustomConfig map[int]*kitdto.AdvancedCustomConfig
var channelSyncLock sync.RWMutex
```

重建逻辑在 `InitChannelCache`(model/channel_cache.go:27-107):先查库构建**全新的** `map`,按优先级排序,然后加写锁一次性替换引用(第 81-99 行),最后放锁再调用 `InvalidatePricingCache()`。注意第 100-104 行的注释明确记录了锁序:`GetPricing` 持有 `updatePricingLock` 时会嵌套取 `channelSyncLock.RLock`,所以这里**必须先释放 `channelSyncLock` 再去拿 `updatePricingLock`**,否则就是 `AB-BA` 死锁。这是并发代码里最值得抄进笔记的一类「防呆注释」。

定时器 `SyncChannelCache`(model/channel_cache.go:109-115)就是一个无限循环 + `sleep`:

```go
func SyncChannelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		InitChannelCache() // 全量重建
	}
}
```

读路径 `GetRandomSatisfiedChannel`(model/channel_cache.go:117-217)只拿 `RLock`,在内存里完成分组过滤、优先级分层、按权重的平滑随机选择——**路由决策零数据库访问**。当 `MemoryCacheEnabled=false` 时,第 124-125 行直接退化为查库的 `GetChannel`。

启动时的接线在 main.go:86-106:`InitChannelCache()` 外面套了一层 `recover` + `FixAbility()` 重试(防止启动期脏数据导致 `panic` 卡死进程),随后 `go model.SyncChannelCache(common.SyncFrequency)`。

### 2️⃣ 用户与令牌:`Redis` 哈希 + 读写栅栏

键与过期时间(默认 60 秒,即 `SyncFrequency`):

- 用户键 `user:{id}`(model/user_cache.go:50-52),TTL 由 `userCacheTTLSeconds()` → `common.RedisKeyCacheSeconds()` → `SyncFrequency`(common/redis.go:19-21)决定;
- 令牌键 `token:{HMAC(原始key)}`(model/token_cache.go:12-14)——**用 `HMAC` 哈希做键**,真实的令牌明文永远不会出现在 `Redis` 里,这是值得学习的安全细节。

读路径是标准 cache-aside:`GetUserCache`(model/user_cache.go:88-115)先 `RedisHGetObj` 读哈希,未命中(或读到过期 schema)则查库回填 `populateUserCache`;令牌侧 `GetTokenByKey`(model/token.go:280-301)同理,并强调「初始化失败不影响本次读取」。

写路径才是精华。令牌更新前先做两件事(model/token.go:310-317 调用 model/token_cache.go:38-48):

```go
// 写库前:先立栅栏、再删缓存
err := common.RDB.Set(ctx, getTokenCacheFenceKey(key), 1, 10*time.Second).Err()
return common.RDB.Del(ctx, getTokenCacheKey(key)).Err()
```

**栅栏不是删掉就完了,而是要让它在删除之后继续存在 10 秒**(token_cache.go:28-33 的注释讲得很透):一个正在读库的读者可能拿着「变更前」的快照,等它读完想回填缓存时,变更已经提交。如果只做删除,这个旧快照会把脏数据重新写回去——这就是经典缓存一致性问题里的「读后写竞争」。栅栏存在期间,回填脚本直接拒绝。

回填是原子 `Lua` 脚本 `cacheInitToken`(model/token_cache.go:56-91):

```lua
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end   -- KEYS[2]=fence,栅栏在 → 拒绝
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[17]); return 2       -- 已存在只刷 TTL,绝不覆盖字段
end
redis.call('HSET', KEYS[1], ...)                            -- 冷缓存才写入完整快照
```

为什么已存在的哈希不能覆盖?因为 `RemainQuota` 字段可能已经被原子预扣扣减过(见第 4 小节),数据库快照是旧的,覆盖它等于把余额「凭空还回去」。

用户侧走得更远,是**版本栅栏**:`writeUserCache` 的 `Lua` 脚本(model/user_auth_cache.go:48-100,比较逻辑在第 66 行)同时比较三个版本——待写入的 `AuthVersion`、pending 栅栏、已提交的版本地板(committed floor)、以及哈希里当前版本,只要任何一个大于待写入版本就拒绝。配合 `userAuthFenceTTLSeconds()`(第 39-47 行)保证「pending 栅栏的寿命必须长于任何可能持有旧快照的用户哈希 TTL」。注释(model/user_auth_cache.go:1-16)把意图写得非常清楚:让「禁用用户 / 改组」这类**收紧授权**的变更,绝不会因为缓存回写而出现「旧快照重新授权」。

### 3️⃣ 动态配置与定价:轮询 + 双重检查锁

`SyncOptions`(model/option.go:211-217)每 60 秒调 `loadOptionsFromDatabase`(第 201-209 行)把全部 `Option` 灌进进程内 `OptionMap`(common/constants.go:56-57,由 `OptionMapRWMutex` 保护)。写入节点上 `UpdateOption`(第 232-249 行)是先落库再直接更新本地 `map`,所以**写节点立即生效,其他节点最迟一个同步周期**。

定价 `GetPricing`(model/pricing.go:70-81)是教科书式的双重检查锁:先无锁判断「距上次刷新超过 1 分钟或缓存为空」,加锁后再判断一次才真正重建;`InvalidatePricingCache`(第 84-89 行)把时间戳归零,由渠道缓存的每次重建和渠道更新主动触发。锁序约定见 model/pricing.go:125-126 的注释:`updatePricingLock` → `channelSyncLock`。

### 4️⃣ 余额预扣:缓存侧原子扣减

这是本项目把「缓存」用成「计费真相」的地方,和普通只读缓存完全不同。`model/quota_reserve.go:42-55` 的 `tokenQuotaReserveScript`:

```lua
if tonumber(redis.call('HGET', KEYS[1], 'Id') or '0') ~= tonumber(ARGV[2]) then return -1 end
local remain = tonumber(redis.call('HGET', KEYS[1], 'RemainQuota'))
if remain == nil or remain < tonumber(ARGV[1]) then return 0 end
redis.call('HINCRBY', KEYS[1], 'RemainQuota', -tonumber(ARGV[1]))
redis.call('HINCRBY', KEYS[1], 'UsedQuota',  tonumber(ARGV[1]))
return 1
```

`TryReserveTokenQuota`(model/quota_reserve.go:203-240)的完整策略:返回 `-1`(哈希不存在/不完整)视为未命中,水合后重试一次;`Redis` 出错则**降级为数据库条件更新**(`reserveTokenQuotaDB`,第 151-160 行,靠 `WHERE remain_quota >= ?` 的行级原子性);缓存侧扣成功后异步落库,若落库失败则反向补偿缓存(第 232-237 行)。若开启 `BATCH_UPDATE_ENABLED`,落库走 `addNewRecord` 攒批合并,`Redis` 余额就成了并发下的第一道闸门。

### 5️⃣ `samber/hot` 与 `pkg/cachex.HybridCache`

`cachex.HybridCache` 是一个泛型的「二选一」缓存:`redisOn()`(pkg/cachex/hybrid_cache.go:59-67)为真走 `Redis`(带 2 秒操作超时、`SCAN` 遍历、`UNLINK` 非阻塞批量删除,第 231-271 行),为假走内存的 `hot.HotCache`(第 108 行)。键统一经 `Namespace.FullKey` 加前缀隔离(pkg/cachex/namespace.go:13-24)。

`samber/hot` 在仓库里只有三处使用:订阅计划缓存(model/subscription.go:89)、渠道亲和缓存(service/channel_affinity.go:101-106)、渠道亲和统计缓存。渠道亲和的构建方式值得一看:

```go
hot.NewHotCache[string, int](hot.LRU, capacity).       // capacity 默认 100_000
    WithTTL(time.Duration(defaultTTLSeconds) * time.Second).
    WithJanitor().                                      // 后台协程清理过期项
    Build()
```

### 6️⃣ 击穿、穿透、雪崩:本项目没做的话

- **击穿**(热点键失效瞬间并发回源):没有 singleflight——`go.mod` 里 `samber/go-singleflightx` 标注为间接依赖,业务代码零调用。实际防护来自三处:① 渠道路径**根本不做过期回源**,是整表重建,重建期间读锁保住旧快照;② 令牌/用户回填由 `Lua` 原子判重,「已存在只刷 TTL」意味着并发读者里只有一个真正写入,其余都退化为刷新;③ 即使重复回源,也只是多几次只读查询,后果可控。
- **穿透**(查询不存在的键):不缓存空值,未命中每次查库。能这么做是因为认证失败路径本身低频,且有全局与关键的速率限制兜底(middleware 层,详见 02-routing-middleware.md)。
- **雪崩**(大批键同时失效):整表重建模式下不存在;`Redis` 哈希侧理论上同一秒初始化的键会一起过期,但栅栏 + 原子回填让「过期」只是退化成一次查库,不构成风暴。

## 📐 图解

图 A:各类数据的缓存归宿与同步机制。

```mermaid
flowchart LR
    subgraph 热路径["请求热路径"]
        AUTH["middleware/auth.go:299/328<br/>令牌+用户认证"]
        ROUTE["GetRandomSatisfiedChannel<br/>(渠道路由)"]
    end

    subgraph 内存["进程内存(单机,重启即失)"]
        CH[("channelsIDM<br/>group2model2channels<br/>channel2advancedCustomConfig")]
        OPT[("OptionMap + pricingMap")]
        HOT[("hot.HotCache<br/>(LRU+TTL+Janitor)")]
    end

    subgraph R["Redis(跨节点共享)"]
        U[("user:{id} 哈希<br/>TTL=SyncFrequency")]
        T[("token:{HMAC(key)} 哈希<br/>+ token:fence 栅栏")]
        HC[("HybridCache 键<br/>订阅计划/渠道亲和")]
    end

    DB[("MySQL / PostgreSQL / SQLite")]

    AUTH -->|"GetTokenByKey"| T
    AUTH -->|"GetUserCache"| U
    ROUTE -->|"channelSyncLock.RLock"| CH
    CH -.|"每 SyncFrequency 秒<br/>全量重建"| DB
    OPT -.|"SyncOptions 每 60 秒轮询"| DB
    U -.|"未命中水合 / 写时字段更新"| DB
    T -.|"未命中水合 / 写前栅栏+DEL"| DB
    HOT -->|"redisOn() ? Redis : 内存"| HC
    HC -.-> DB
```

图 B:渠道缓存的定时全量重建——为什么读路径永远不必等。

```mermaid
sequenceDiagram
    participant S as SyncChannelCache 协程
    participant I as InitChannelCache
    participant DB as 数据库
    participant L as channelSyncLock
    participant R as 读请求

    loop 每 SyncFrequency 秒(默认 60)
        S->>I: 触发重建
        I->>DB: DB.Find(channels) + DB.Find(abilities)
        I->>I: 构建 newGroup2model2channels<br/>并按优先级排序(未持锁)
        I->>L: Lock()
        I->>I: 一次性替换三个 map<br/>(保留多 Key 轮询游标)
        I->>L: Unlock()
        I->>I: InvalidatePricingCache()<br/>锁序:先放锁再取 updatePricingLock
        Note over R,L: 读请求只持 RLock;<br/>重建期间读到旧快照,不会阻塞也不会读空
    end
```

图 C:令牌缓存的「写前栅栏 + 原子水合」,阻止旧快照回写。

```mermaid
sequenceDiagram
    participant W as 写请求(更新令牌)
    participant R as Redis
    participant Rd as 读请求(认证)
    participant DB as 数据库

    W->>R: SET token:fence:{hmac} = 1,TTL 10 秒
    W->>R: DEL token:{hmac}
    W->>DB: UPDATE tokens ...
    Rd->>R: HGETALL token:{hmac} → 未命中
    Rd->>DB: SELECT ... WHERE key = ?
    Rd->>R: EVAL cacheInitToken(Lua)
    R-->>R: fence 仍存在 → 返回 0,拒绝回写
    Note over Rd,DB: 本次用数据库快照放行;<br/>栅栏自然过期后,下一个读者完成水合
```

## 🎓 设计精妙之处与可借鉴点

**1. 按实体分家,而不是硬套 L1/L2。** 为什么:路由数据的读频极高但变更语义是「整表替换」,共享缓存反而引入网络往返和一致性负担;用户余额恰恰需要跨节点共享的原子性。可借鉴:在 Java 里先按「读频 / 变更粒度 / 是否跨节点」给数据分类,再选机制——不要无脑给所有实体套 `@Cacheable` + `Redis`。

**2. 全量重建 + 不可变快照替换。** 为什么:把「缓存失效 → 单条回源」的并发难题,换成「周期性整表重算 + 引用替换」,读路径只需读锁甚至无锁,代码简单且天然自愈(脏数据最多活一个周期)。可借鉴:`Caffeine` 没有「整表重建」原语,可以用 `AtomicReference<Map<K,V>>` 包一层定时任务,或对聚合数据用「快照对象 + `volatile` 引用」的写法——这正是 Java 里不可变对象模式的实战价值。

**3. 写前栅栏(fence)替代延迟双删。** 为什么:延迟双删靠时间差赌运气,栅栏用「一个持续存在的 `Redis` 键 + `Lua` 条件判断」把旧快照的回写**硬性拒绝**,并且栅栏 `TTL` 有明确推导(必须长于可能持有旧快照的缓存 `TTL`)。可借鉴:在 `Redis` + 本地缓存混合的 Java 项目里,把「更新前 `SET fence`、回填前检查 `fence`」封装进统一的缓存门面(`CacheLoader` 包装),比在业务代码里到处「先删缓存再更新」可靠得多。

**4. 把版本号搬进缓存(乐观锁思想作用于缓存)。** 为什么:用户授权类变更(禁用、降权)的安全问题是「旧快照重新授权」,单纯删除缓存挡不住并发的读-回写竞争;`AuthVersion` 单调递增 + 比较拒绝,让任何过期写入无处遁形。可借鉴:等价于在缓存值里内嵌 `@Version` 字段并在 `Redis` 写入前做 `WATCH`/`Lua` 比较,对「权限、配额」这类收紧语义的字段尤其值得。

**5. 缓存参与计费,但降级路径必须完备。** 为什么:`Redis` 哈希里的余额是并发预扣的第一道闸,但代码从不假设它一定可用——出错就退回数据库条件更新,落库失败就补偿缓存。可借鉴:`Java` 里做「缓存即真相」时,一定要定义三条路径:命中、未命中水合、缓存不可用降级,并保证降级路径的数据库操作本身是原子的(条件 `UPDATE` + `RowsAffected` 判断,对应 `MySQL`/`PG` 都是安全的)。

**6. 把锁序写进注释。** 为什么:`updatePricingLock` → `channelSyncLock` 这类约定一旦被新代码破坏,就是难以复现的死锁。可借鉴:在 Java 项目里用注释或静态检查固化「全局锁序表」,凡是「先 A 后 B」的路径都要自查反向路径。

## ⚠️ 常见坑与注意事项

- **不要假设开了 `Redis` 就有分布式渠道路由。** 渠道/能力只在各节点进程内存里(main.go:82-85 强制开内存缓存的原因),多节点间渠道变更的生效延迟是 `SyncFrequency` 秒;紧急封禁某渠道后,可调用 `CacheUpdateChannelStatus`(model/channel_cache.go:251-274)让**本节点**立即摘除。
- **`SYNC_FREQUENCY` 是全局一致性窗口。** 默认 60 秒(common/init.go:112;`Redis` 模式下 common/redis.go:30-33 也强制为 60),同时决定用户/令牌哈希 `TTL` 和渠道/配置轮询间隔。调小会加大 `Redis` 与数据库压力,调大会放大「改了配置其他节点没生效」的困惑。
- **不要手工改动 `Redis` 里的用户/令牌哈希字段。** `RedisHSetObj`/`RedisHGetObj`(common/redis.go:107-239)用反射按字段名序列化,布尔值存 `"true"/"false"` 字符串,手写 `HSET` 极易造成类型不匹配导致整条读取失败。
- **令牌缓存键是 `HMAC`,不是明文。** 排查问题时直接 `GET token:sk-xxx` 会落空;另外 `GetTokenByKey` 的键在中间件里会先 `TrimPrefix("sk-")` 并按 `-` 切分(middleware/auth.go:294-299)。
- **改数据库不会改缓存。** 绕过模型层方法直接 `UPDATE` 数据库,进程内存的渠道快照要等下一个同步周期才会刷新;`pricingMap` 还要等 `InvalidatePricingCache` 被触发。这是「缓存只有模型层知道」这一设计的代价。
- **`BATCH_UPDATE_ENABLED=true` 时数据库余额会滞后。** 预扣以 `Redis` 为准,落库攒批;此时对账必须以 `Redis` 加未落库批次为准,不能只看数据库。
- **三库兼容约束同样约束缓存代码。** 涉及缓存回源查询的 `SQL` 要遵守 `AGENTS.md` 的三库规则(保留字列用 `commonKeyCol` 等),缓存水合失败会直接退化为数据库路径。

## 🏋️ 刻意练习:缺陷预演

> 先自己想 2 分钟,再看参考思路。

### 练习 1|令牌写前栅栏:封禁一个已泄露的令牌

- 🔴 **反模式预演**:把 `invalidateTokenCacheForMutation`(model/token_cache.go:38-48)简化成教科书式的 cache-aside——「写库后 `DEL` 缓存」,栅栏整个去掉。现场:某令牌的 key 已泄露到 GitHub,管理员正在后台禁用它;同一瞬间,一个读者的 `GetTokenByKey` 恰好缓存未命中、已经拿着变更前的数据在查库并准备回填(model/token.go:289-298)。请推演:这个读者回填成功后,`Redis` 哈希里的 `Status` 是什么?接下来一个缓存 `TTL`(默认 60 秒)内,攻击者的请求在哪一步被放行?为什么 `tokenQuotaReserveScript`(model/quota_reserve.go:42-55)这道「余额闸门」一个都拦不住?
- 🟡 **陷阱预判**:就算保留栅栏,有人嫌「栅栏拖慢封禁生效」,把 `tokenCacheFenceSeconds` 从 10 秒压到 1 秒(model/token_cache.go:33),会打开什么口子?对照用户侧栅栏 `TTL` 是 `cacheTTL + max(cacheTTL, 60)`(model/user_auth_cache.go:39-46),两者的推导依据差在哪?
- 💡 **参考思路**:回填把变更前的 `Status=enabled` 快照写回缓存,而认证层只在读到禁用状态时才拒绝(middleware/auth.go:319-322),预扣脚本又只校验 `Id` 与 `RemainQuota`/`UsedQuota` 字段存在、根本不看 `Status`——被吊销的令牌在禁用后整整一个缓存周期内继续可用,资损窗口就等于缓存 `TTL`。栅栏的本质是把「回填竞态」从时间差博弈改成硬性拒绝:被拒的读者只用数据库快照服务自己这一笔,不污染后续请求。栅栏 `TTL` 不是拍脑袋的数字,必须覆盖「写库耗时 + 最坏在途读者的查库到回填间隔」;用户侧还要再多盖住一个完整哈希 `TTL`,因为授权事务可能回滚,得靠自然过期自愈。

### 练习 2|预扣原子性:把 `Lua` 脚本拆成两步普通命令

- 🔴 **反模式预演**:有人嫌 `tokenQuotaReserveScript` 又 `HGET` 又 `HINCRBY` 太绕,改成 Go 里两步:先 `HGET RemainQuota` 在应用层判断够不够,够就 `HINCRBY` 扣。某令牌 `RemainQuota=100_000`、非无限额度,用户并发打 50 个请求、每个预扣 80_000。请推演 50 个协程交错执行后 `RemainQuota` 变成多少;这 50 笔上游调用的真实费用谁买单?结算阶段的反向补偿(model/quota_reserve.go:232-237)救得回来吗?
- 🟡 **陷阱预判**:落库失败后的补偿走 `cacheApplyTokenQuotaDelta`(model/quota_reserve.go:57-66),它**故意不做余额校验**、直接把额度加回去;而回填脚本对已存在的哈希只刷 `TTL`、绝不覆盖字段(model/token_cache.go:68-71)。如果有人「顺手优化」成补偿时从数据库重读余额、整体覆盖缓存,会冲掉什么?
- 💡 **参考思路**:50 个请求全部读到 100_000、全部判断通过、全部扣减,余额变成 `-3_900_000`——这是把「校验+扣减」拆成两步后典型的先查后改(check-then-act)竞态;`Lua` 脚本借 `Redis` 单线程把它固化成一个不可分割的命令。上游费用是真金白银的消耗,补偿只能修正本地账目、救不回上游成本;而「重读余额覆盖缓存」会冲掉**其他并发请求已经预扣的额度**,这正是「快照绝不覆盖活哈希」(model/token_cache.go:50-54)要防的事,数据库降级路径用 `WHERE remain_quota >= ?` 加 `RowsAffected` 判断(model/quota_reserve.go:151-160)复刻了同一个不变量。

### 练习 3|渠道整表重建:锁内做 IO 与锁序反转

- 🔴 **反模式预演**:把 `InitChannelCache` 改成「先加写锁、在锁内查库、建 `map`、替换引用」——也就是把两次 `DB.Find`(model/channel_cache.go:36、model/channel_cache.go:46)搬进 `channelSyncLock.Lock()`(model/channel_cache.go:81)之后。现场:数据库出现一条 8 秒的慢查询,此刻每秒 2000 条请求涌入。推演 `GetRandomSatisfiedChannel` 的读锁(model/channel_cache.go:128-129)会怎样,全站请求堆积在哪一步。再追问:把 `InvalidatePricingCache()`(model/channel_cache.go:104)挪到 `Unlock()` 之前执行,又会发生什么?
- 💡 **参考思路**:写锁内做 IO,所有读锁排队,路由从纯内存计算退化成「等数据库慢查询」,请求在网关入口堆积成雪崩;先在锁外建好新表、锁内只做引用替换,保证读路径要么读到完整旧快照、要么读到完整新快照,永远读不到半成品。把 `InvalidatePricingCache` 挪进写锁内就构成 `channelSyncLock → updatePricingLock` 的反向加锁,而 `GetPricing` 持有 `updatePricingLock` 时会经 `loadPricingAdvancedCustomConfigs` 嵌套取 `channelSyncLock.RLock`(model/pricing.go:124-132、model/pricing.go:151-152),两条路径互相挂死且无法自愈——这正是 model/channel_cache.go:100-104 那段注释立碑要防的 `AB-BA` 死锁。

## 🔗 与其他模块的关系

- 启动顺序、`InitChannelCache` 的 `panic` 恢复与各后台协程的拉起,详见 01-startup-lifecycle.md。
- 认证中间件如何消费 `GetTokenByKey` / `GetUserCache`,详见 09-auth-user.md。
- `group2model2channels` 的优先级 / 权重选择算法与能力表结构,详见 08-channel-ability.md。
- 预扣费与结算链路(`TryReserveTokenQuota` 的调用方),详见 06-billing-overview.md;表达式计费的配额换算见 07-billingexpr.md。
- `OptionMap` 的键如何映射到各 `setting` 包、以及管理后台改配置的传播路径,详见 13-settings.md。
- 磁盘缓存(common/disk_cache.go,用于大请求体/文件落盘)不属于本篇的一致性缓存体系,但与请求体存储相关,详见 12-logging-dashboard.md。
- 数据看板的内存聚合在 `MemoryCacheEnabled` 分支下复用 `CacheGetChannel`(model/usedata_flow.go:150),详见 12-logging-dashboard.md。

## 📚 小结

new-api 的缓存体系可以压缩成三句话:**第一,按实体分家**——路由数据住在进程内存里靠整表重建,认证与余额住在 `Redis` 哈希里靠写时失效加读时水合,配置住在进程内靠轮询;**第二,一致性是买来的**——多节点之间接受一个 `SyncFrequency`(默认 60 秒)的最终一致窗口,而授权收紧、余额扣减这类不能等的地方,用栅栏、版本地板和 `Lua` 原子操作把窗口压到零;**第三,简单优先**——没有 singleflight、没有复杂的失效广播,靠「旧快照无害化」和「降级路径完备」把并发正确性做扎实。对照 Java:这套思路落地就是「`Caffeine` 管聚合快照、`Redis` 管共享真相、`Lua` 管条件写入、版本号管授权安全」,四件事凑齐,大多数网关类系统的缓存难题也就覆盖了。
