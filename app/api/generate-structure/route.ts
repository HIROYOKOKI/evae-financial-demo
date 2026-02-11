// app/api/generate-structure/route.ts
import { NextResponse } from "next/server";

type Payload = {
  age?: number;
  job?: string;
  family?: string;
  incomeMan?: number;
  assetsMan?: number;
  otherDebtMan?: number;
  loanRequestMan?: number;

  userConfirmed?: boolean;
  confirmedAt?: string;
  confirmText?: any;
};

const POLICY = {
  bank: "仮想銀行A",
  dtiMaxPct: 35,
  downPaymentMinPct: 10,
  annualRatePct: 1.5,
  years: 35,
  ltiMax: 7,
  otherDebtMonthlyPct: 2,
};

type Bottleneck = "DTI" | "DOWN" | "LTI" | null;
type BottleneckKey = Exclude<Bottleneck, null>;

function pickBottleneck(dtiPct: number, downPct: number, lti: number): Bottleneck {
  const dtiGap = dtiPct - POLICY.dtiMaxPct;              // >0 bad
  const downGap = POLICY.downPaymentMinPct - downPct;     // >0 bad
  const ltiGap = lti - POLICY.ltiMax;                     // >0 bad

  // ★ ここで literal を固定（string widening を潰す）
  const candidates = [
    { k: "DTI", v: dtiGap },
    { k: "DOWN", v: downGap },
    { k: "LTI", v: ltiGap },
  ] as const;

  const bads: { k: BottleneckKey; v: number }[] = candidates
    .map((x) => ({ k: x.k as BottleneckKey, v: x.v }))
    .filter((x) => x.v > 0);

  if (bads.length === 0) return null;

  bads.sort((a, b) => b.v - a.v);
  return bads[0].k;
}


function buildPlans(params: {
  incomeMan: number;
  loanMan: number;
  assetsMan: number;
  otherDebtMan: number;
  monthlyIncomeMan: number;
  estMortgagePayMan: number;
  estOtherDebtPayMan: number;
  dtiPct: number;
  downPaymentPct: number;
  lti: number;
  bottleneck: Bottleneck;
  required: {
    reduceLoanManForDTI: number;
    increaseAssetsManForDownPayment: number;
    reduceOtherDebtMan: number;
  };
}) {
  const { bottleneck, required } = params;

  const plans: Array<{ title: string; impact: string; steps: string[] }> = [];

  // helper
  const fmt = (n: number) => `${round1(Math.max(0, n))}万円`;

  // Plan A: bottleneck first
  if (bottleneck === "DOWN") {
    plans.push({
      title: "Plan A（最短）",
      impact: "頭金比率を最低基準へ到達させる",
      steps: [
        `自己資金を +${fmt(required.increaseAssetsManForDownPayment)}`,
        `（代替）申込金額を -${fmt(required.reduceLoanManForDTI)} ※DTI側も同時に改善する可能性`,
      ],
    });
  } else if (bottleneck === "DTI") {
    plans.push({
      title: "Plan A（最短）",
      impact: "DTIを上限内へ戻す",
      steps: [
        `申込金額を -${fmt(required.reduceLoanManForDTI)}`,
        `（代替）他の借入を -${fmt(required.reduceOtherDebtMan)}（月返済負担を軽くする）`,
      ],
    });
  } else if (bottleneck === "LTI") {
    // LTIは「借入/年収」なので、借入減か年収増の2択
    const reduceLoanForLTI = params.loanMan - POLICY.ltiMax * params.incomeMan;
    plans.push({
      title: "Plan A（最短）",
      impact: "LTIを目安内へ戻す",
      steps: [
        `申込金額を -${fmt(reduceLoanForLTI)}`,
        `（代替）年収を +${fmt(params.loanMan / POLICY.ltiMax - params.incomeMan)}（到達目安）`,
      ],
    });
  } else {
    // PASS時：余裕度を強化する提案（“戦略”）
    plans.push({
      title: "Plan A（余裕を増やす）",
      impact: "将来変動（金利/生活費）に備えて余裕度を増やす",
      steps: [
        "頭金をもう1段積む（リスク低下・金利条件の改善余地）",
        "他債務を圧縮してDTIの余裕を確保する",
      ],
    });
  }

  // Plan B: realistic balancing
  plans.push({
    title: "Plan B（現実）",
    impact: "複数項目を少しずつ改善してリスクを分散",
    steps: [
      required.reduceLoanManForDTI > 0 ? `申込金額を -${fmt(required.reduceLoanManForDTI * 0.6)}` : "申込金額の微調整（レンジで再計算）",
      required.increaseAssetsManForDownPayment > 0 ? `自己資金を +${fmt(required.increaseAssetsManForDownPayment * 0.6)}` : "自己資金の上積み（ボーナス等）",
      required.reduceOtherDebtMan > 0 ? `他の借入を -${fmt(required.reduceOtherDebtMan * 0.6)}` : "他債務の支払計画を見直す",
    ],
  });

  // Plan C: conservative
  plans.push({
    title: "Plan C（保守）",
    impact: "前提を変えずに“条件”側で安全域を確保",
    steps: [
      "金利が上振れした場合（+0.5〜1.0%）で再計算する",
      "返済期間・物件価格帯を見直して月返済の上限を固定する",
      "実運用では勤続年数・貯蓄推移などを追加して精緻化する",
    ],
  });

  return plans;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Payload;

  const E = {
    age: body.age,
    job: body.job,
    family: body.family,
    incomeMan: fin(body.incomeMan),
    assetsMan: fin(body.assetsMan),
    otherDebtMan: fin(body.otherDebtMan),
    loanRequestMan: fin(body.loanRequestMan),
    userConfirmed: !!body.userConfirmed,
    confirmedAt: body.confirmedAt,
  };

  const gateReasons: string[] = [];
  const softFlags: string[] = [];

  // --- Input validation gates ---
  if (E.incomeMan <= 0) gateReasons.push("年収が未入力/0のため、指標計算が成立しない");
  if (E.loanRequestMan <= 0) gateReasons.push("申込金額が未入力/0のため、指標計算が成立しない");
  if (E.assetsMan < 0) gateReasons.push("自己資金が負の値");
  if (E.otherDebtMan < 0) gateReasons.push("他債務が負の値");

  // --- Metrics ---
  const monthlyIncomeMan = E.incomeMan > 0 ? E.incomeMan / 12 : 0;
  const estOtherDebtPayMan = E.otherDebtMan > 0 ? E.otherDebtMan * (POLICY.otherDebtMonthlyPct / 100) : 0;
  const estMortgagePayMan = amortPaymentMan(E.loanRequestMan, POLICY.annualRatePct, POLICY.years);

  const dtiPct =
    monthlyIncomeMan > 0 ? ((estMortgagePayMan + estOtherDebtPayMan) / monthlyIncomeMan) * 100 : 0;

  const downPaymentPct =
    E.loanRequestMan + E.assetsMan > 0 ? (E.assetsMan / (E.loanRequestMan + E.assetsMan)) * 100 : 0;

  const lti = E.incomeMan > 0 ? E.loanRequestMan / E.incomeMan : 0;

  // --- Policy gates ---
  if (gateReasons.length === 0) {
    if (dtiPct > POLICY.dtiMaxPct) gateReasons.push(`DTIが上限(${POLICY.dtiMaxPct}%)を超過`);
    if (downPaymentPct < POLICY.downPaymentMinPct) gateReasons.push(`頭金比率が最低(${POLICY.downPaymentMinPct}%)を下回る`);
    if (lti > POLICY.ltiMax) gateReasons.push(`LTIが目安上限(${POLICY.ltiMax}倍)を超過`);
  }

  // --- Soft flags (do not change result) ---
  if (typeof E.age === "number" && E.age > 0 && E.age + POLICY.years > 80) {
    softFlags.push("完済時年齢が高い可能性（追加確認が必要）");
  }
  if (E.job && ["自営業", "契約/派遣", "パート/アルバイト"].includes(E.job)) {
    softFlags.push("雇用形態により収入安定性の追加確認が必要（デモ）");
  }
  if (E.family && E.family.includes("子")) {
    softFlags.push("家族構成により生活費前提の精緻化余地（デモ）");
  }

  const result = gateReasons.length > 0 ? "HOLD" : "PASS";

  // --- required (improvement estimates) ---
  let reduceLoanManForDTI = 0;
  let increaseAssetsManForDownPayment = 0;
  let reduceOtherDebtMan = 0;

  if (E.incomeMan > 0 && E.loanRequestMan > 0) {
    const maxPayMan = monthlyIncomeMan * (POLICY.dtiMaxPct / 100);
    const allowMortgagePay = maxPayMan - estOtherDebtPayMan;

    if (allowMortgagePay <= 0) {
      const needReducePay = estOtherDebtPayMan - maxPayMan;
      if (needReducePay > 0) {
        reduceOtherDebtMan = needReducePay / (POLICY.otherDebtMonthlyPct / 100);
      }
    } else {
      const principalAllowed = principalFromPaymentMan(allowMortgagePay, POLICY.annualRatePct, POLICY.years);
      const reduce = E.loanRequestMan - principalAllowed;
      if (reduce > 0) reduceLoanManForDTI = reduce;
    }

    const requiredAssets = (POLICY.downPaymentMinPct / (100 - POLICY.downPaymentMinPct)) * E.loanRequestMan;
    const inc = requiredAssets - E.assetsMan;
    if (inc > 0) increaseAssetsManForDownPayment = inc;
  }

  const required = {
    reduceLoanManForDTI: round1(Math.max(0, reduceLoanManForDTI)),
    increaseAssetsManForDownPayment: round1(Math.max(0, increaseAssetsManForDownPayment)),
    reduceOtherDebtMan: round1(Math.max(0, reduceOtherDebtMan)),
  };

  // --- headroom (PASSでも見せる：境界の可視化) ---
  const headroom = {
    dtiPct: round1(POLICY.dtiMaxPct - dtiPct), // +なら余裕、-なら超過
    downPaymentPct: round1(downPaymentPct - POLICY.downPaymentMinPct), // +なら余裕、-なら不足
    lti: round1(POLICY.ltiMax - lti), // +なら余裕、-なら超過
  };

  const bottleneck: Bottleneck = pickBottleneck(dtiPct, downPaymentPct, lti);

  const plans = buildPlans({
    incomeMan: E.incomeMan,
    loanMan: E.loanRequestMan,
    assetsMan: E.assetsMan,
    otherDebtMan: E.otherDebtMan,
    monthlyIncomeMan,
    estMortgagePayMan,
    estOtherDebtPayMan,
    dtiPct,
    downPaymentPct,
    lti,
    bottleneck,
    required,
  });

  const V = [
    "返済負担（DTI）・頭金比率・年収倍率（LTI）で、ルール判定の前提となる構造を数値化します。",
    "本デモは融資の可否を決定しません。Policy Gate の結果は「検討状態（PASS/HOLD）」として表示します。",
    "PASSでも境界（しきい値）に対する余裕度を可視化し、再検討の論点として残します。",
  ];

  const traceId = `trace_${Date.now()}`;
  const generatedAt = new Date().toISOString();

  const traceLambda = {
    ruleId: "MORTGAGE_STD_001",
    result,
    gateReasons,
    softFlags,
    bottleneck,
    headroom,
    policy: POLICY,
    required,
  };

  return NextResponse.json({
    V,
    Lambda: {
      method: "Policy Gate",
      ruleId: "MORTGAGE_STD_001",
      result,
      note: "実行時の人介在なし（ルール確定）",

      // ✅ NEW
      gateReasons,
      bottleneck,
      headroom,
      plans,

      // 既存互換
      flags: [...gateReasons, ...softFlags],
      policy: {
        bank: POLICY.bank,
        dtiMaxPct: POLICY.dtiMaxPct,
        downPaymentMinPct: POLICY.downPaymentMinPct,
        annualRatePct: POLICY.annualRatePct,
        years: POLICY.years,
      },
      metrics: {
        monthlyIncomeMan: round1(monthlyIncomeMan),
        principalMan: round1(E.loanRequestMan),
        estMortgagePayMan: round1(estMortgagePayMan),
        estOtherDebtPayMan: round1(estOtherDebtPayMan),
        dtiPct: round1(dtiPct),
        downPaymentPct: round1(downPaymentPct),
        lti: round1(lti),
      },
      required,
    },
    Trace: {
      reason:
        result === "PASS"
          ? "主要指標がポリシー範囲内（ただし可否は決定しない）。余裕度はTraceとして固定。"
          : `ポリシーゲートにより再検討が必要：${gateReasons.join(" / ")}`,
      actions:
        result === "PASS"
          ? [
              `余裕度：DTI +${headroom.dtiPct}% / 頭金 +${headroom.downPaymentPct}% / LTI +${headroom.lti}倍（境界に対する余裕）`,
              "金利上振れ（+0.5〜1.0%）でも成立するかを再計算する",
              "実運用では勤続年数・貯蓄推移等の追加で精緻化する",
            ]
          : [
              "HOLD要因（ゲート理由）を最優先に改善する",
              "Plan A/B/C に沿って、借入・自己資金・他債務のどれを動かすか決める",
            ],
      log: {
        E: JSON.stringify(E),
        V: JSON.stringify(V),
        Lambda: JSON.stringify(traceLambda),
        Trace: JSON.stringify({ traceId, generatedAt }),
      },
    },
    meta: {
      model: "rule-based",
      visionNote: "論点生成のみ（可否判断なし）",
      traceId,
      generatedAt,
    },
  });
}
