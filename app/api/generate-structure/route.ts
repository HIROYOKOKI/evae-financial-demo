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

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function fin(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function amortPaymentMan(principalMan: number, annualRatePct: number, years: number) {
  const r = annualRatePct / 100 / 12;
  const n = Math.max(1, Math.round(years * 12));
  if (principalMan <= 0) return 0;
  if (r === 0) return principalMan / n;
  const pow = Math.pow(1 + r, n);
  return (principalMan * r * pow) / (pow - 1);
}

function principalFromPaymentMan(paymentMan: number, annualRatePct: number, years: number) {
  const r = annualRatePct / 100 / 12;
  const n = Math.max(1, Math.round(years * 12));
  if (paymentMan <= 0) return 0;
  if (r === 0) return paymentMan * n;
  const pow = Math.pow(1 + r, n);
  return paymentMan * ((pow - 1) / (r * pow));
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
  const flags: string[] = [];

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
    flags.push("完済時年齢が高い可能性（追加確認が必要）");
  }
  if (E.job && ["自営業", "契約/派遣", "パート/アルバイト"].includes(E.job)) {
    flags.push("雇用形態により収入安定性の追加確認が必要（デモ）");
  }
  if (E.family && E.family.includes("子")) {
    flags.push("家族構成により生活費前提の精緻化余地（デモ）");
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
      // need to reduce other debt so that (otherDebtPay) <= maxPayMan
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

  const V = [
    "返済負担（DTI）・頭金比率・年収倍率（LTI）で、ルール判定の前提となる構造を数値化します。",
    "本デモは融資の可否を決定しません。Policy Gate の結果は「検討状態（PASS/HOLD）」として表示します。",
    "HOLDの場合は、再検討に必要な調整案（借入額・自己資金・他債務）を概算で提示します。",
  ];

  const traceId = `trace_${Date.now()}`;

  return NextResponse.json({
    V,
    Lambda: {
      method: "Policy Gate",
      ruleId: "MORTGAGE_STD_001",
      result,
      note: "実行時の人介在なし（ルール確定）",
      flags: [...gateReasons, ...flags],
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
      required: {
        reduceLoanManForDTI: round1(Math.max(0, reduceLoanManForDTI)),
        increaseAssetsManForDownPayment: round1(Math.max(0, increaseAssetsManForDownPayment)),
        reduceOtherDebtMan: round1(Math.max(0, reduceOtherDebtMan)),
      },
    },
    Trace: {
      reason:
        result === "PASS"
          ? "主要指標がポリシー範囲内（ただし可否は決定しない）"
          : `ポリシーゲートにより再検討が必要：${gateReasons.join(" / ")}`,
      actions:
        result === "PASS"
          ? ["金利条件や物件価格の変動を想定し、レンジでの再計算を行う", "実運用では審査情報（勤続年数等）を追加する"]
          : [
              "DTI・頭金比率・LTIのどれがボトルネックかを分解し、1項目ずつ改善する",
              "他債務を圧縮するか、自己資金を増やすか、申込金額を調整する",
            ],
      log: {
        E: JSON.stringify(E),
        V: JSON.stringify(V),
        Lambda: JSON.stringify({ ruleId: "MORTGAGE_STD_001", result, gateReasons, flags, policy: POLICY }),
        Trace: JSON.stringify({ traceId, generatedAt: new Date().toISOString() }),
      },
    },
    meta: {
      model: "rule-based",
      visionNote: "論点生成のみ（可否判断なし）",
      traceId,
      generatedAt: new Date().toISOString(),
    },
  });
}
