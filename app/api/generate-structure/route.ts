// app/api/generate-structure/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type InputPayload = {
  bank?: string;
  age?: number;
  job?: string;
  incomeMan?: number; // 年収(万円)
  family?: string;
  assetsMan?: number; // 自己資金(万円)
  otherDebtMan?: number; // 他借入(万円)
  loanRequestMan?: number; // 申込金額(万円)
};

type BankPolicy = {
  bank: string;
  ruleId: string;
  dtiMaxPct: number;
  downPaymentMinPct: number;
  annualRatePct: number;
  years: number;
  // LTI上限（デモ用に追加。不要なら削ってもOK）
  ltiMax: number;
  // 他借入の月返済推定係数（借入残高×係数＝月返済(万円)）
  otherDebtPayCoeff: number;
};

const BANK_POLICIES: Record<string, BankPolicy> = {
  "架空銀行A": {
    bank: "架空銀行A（Demo）",
    ruleId: "MORTGAGE_STD_001",
    dtiMaxPct: 35,
    downPaymentMinPct: 10,
    annualRatePct: 1.5,
    years: 35,
    ltiMax: 8.0,
    otherDebtPayCoeff: 0.001, // 例: 100万円の借入 → 0.1万円/月
  },
  "架空銀行B": {
    bank: "架空銀行B（保守）",
    ruleId: "MORTGAGE_CONS_001",
    dtiMaxPct: 30,
    downPaymentMinPct: 15,
    annualRatePct: 1.8,
    years: 35,
    ltiMax: 7.0,
    otherDebtPayCoeff: 0.0012,
  },
  "架空銀行C": {
    bank: "架空銀行C（積極）",
    ruleId: "MORTGAGE_GROW_001",
    dtiMaxPct: 40,
    downPaymentMinPct: 5,
    annualRatePct: 1.2,
    years: 40,
    ltiMax: 9.0,
    otherDebtPayCoeff: 0.0009,
  },
};

function clampNum(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** PMT: 毎月返済額（万円） */
function pmtMan(principalMan: number, annualRatePct: number, years: number) {
  const P = principalMan; // 万円
  const r = (annualRatePct / 100) / 12;
  const n = years * 12;

  if (P <= 0) return 0;
  if (r === 0) return P / n;

  const denom = 1 - Math.pow(1 + r, -n);
  return (P * r) / denom;
}

/** PV: 返済額上限から逆算できる最大元本（万円） */
function pvFromPmtMan(pmtMonthlyMan: number, annualRatePct: number, years: number) {
  const r = (annualRatePct / 100) / 12;
  const n = years * 12;

  if (pmtMonthlyMan <= 0) return 0;
  if (r === 0) return pmtMonthlyMan * n;

  const factor = (1 - Math.pow(1 + r, -n)) / r;
  return pmtMonthlyMan * factor;
}

/** 頭金最低 p% を満たすために必要な追加自己資金（万円） */
function requiredExtraAssetsForDownPayment(assetsMan: number, loanMan: number, minPct: number) {
  const p = minPct / 100;
  if (p <= 0) return 0;

  // (assets+x)/(assets+x+loan) >= p
  // assets+x >= p*(assets+x+loan)
  // (1-p)*(assets+x) >= p*loan
  // assets+x >= (p*loan)/(1-p)
  const targetAssets = (p * loanMan) / (1 - p);
  return Math.max(0, targetAssets - assetsMan);
}

/** LLMでV（論点）を生成（キーがない場合はフォールバック） */
async function generateVisionPoints(input: {
  incomeMan: number;
  assetsMan: number;
  otherDebtMan: number;
  loanRequestMan: number;
  family?: string;
  job?: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const fallback = [
    "申込金額に対する年収の割合に関する論点",
    "家族構成が返済能力に与える影響",
    "自己資金の割合が融資条件に与える影響",
    "他の借入がないことのメリットとリスクに関する論点",
  ];

  if (!apiKey) return { points: fallback, meta: { model: "fallback", visionNote: "LLM未接続（フォールバック）" } };

  const prompt = `
あなたは金融の与信設計に詳しいアシスタントです。
ただし「可否判断」や「数値の断定」は禁止です。
入力条件から、検討すべき論点（箇条書き4〜6点）だけを日本語で生成してください。

入力：
- 年収(万円): ${input.incomeMan}
- 自己資金(万円): ${input.assetsMan}
- 他借入(万円): ${input.otherDebtMan}
- 申込金額(万円): ${input.loanRequestMan}
- 家族構成: ${input.family ?? "未入力"}
- 職業: ${input.job ?? "未入力"}

出力形式：
- 箇条書き（文章は短め）
- 可否の示唆は禁止
- 数値の断定は禁止（例「DTIは◯%」などは禁止）
`.trim();

  try {
    // Chat Completions互換（fetchで軽く）
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: "You are a careful assistant. Do not make approval/denial decisions." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok) throw new Error(`openai ${r.status}`);

    const j = await r.json();
    const text: string = j?.choices?.[0]?.message?.content ?? "";
    const lines = text
      .split("\n")
      .map((s: string) => s.replace(/^[-•\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 8);

    return {
      points: lines.length ? lines : fallback,
      meta: { model, visionNote: "LLMで生成" },
    };
  } catch {
    return { points: fallback, meta: { model: "fallback", visionNote: "LLMエラー（フォールバック）" } };
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as InputPayload;

  // 入力（デモなので未入力は0扱いで動かす）
  const bankKey = (body.bank ?? "架空銀行A").trim();
  const policy = BANK_POLICIES[bankKey] ?? BANK_POLICIES["架空銀行A"];

  const incomeMan = clampNum(body.incomeMan, 0);
  const assetsMan = clampNum(body.assetsMan, 0);
  const otherDebtMan = clampNum(body.otherDebtMan, 0);
  const loanRequestMan = clampNum(body.loanRequestMan, 0);

  // --- metrics（ルール計算） ---
  const monthlyIncomeMan = incomeMan > 0 ? +(incomeMan / 12).toFixed(1) : 0;

  const principalMan = loanRequestMan;

  const estMortgagePayMan = principalMan > 0
    ? +pmtMan(principalMan, policy.annualRatePct, policy.years).toFixed(1)
    : 0;

  const estOtherDebtPayMan = otherDebtMan > 0
    ? +(otherDebtMan * policy.otherDebtPayCoeff).toFixed(1)
    : 0;

  const dtiPct = monthlyIncomeMan > 0
    ? +(((estMortgagePayMan + estOtherDebtPayMan) / monthlyIncomeMan) * 100).toFixed(1)
    : 0;

  const downPaymentPct = (assetsMan + loanRequestMan) > 0
    ? +((assetsMan / (assetsMan + loanRequestMan)) * 100).toFixed(1)
    : 0;

  const lti = incomeMan > 0 ? +(loanRequestMan / incomeMan).toFixed(1) : 0;

  // --- policy gate判定（PASS/HOLD） ---
  const flags: string[] = [];

  if (incomeMan <= 0) flags.push("年収が未入力（または0）です");
  if (loanRequestMan <= 0) flags.push("申込金額が未入力（または0）です");

  if (monthlyIncomeMan > 0 && dtiPct > policy.dtiMaxPct) {
    flags.push(`DTIが上限を超過（${dtiPct}% > ${policy.dtiMaxPct}%）`);
  }

  if (downPaymentPct < policy.downPaymentMinPct) {
    flags.push(`頭金比率が最低基準未満（${downPaymentPct}% < ${policy.downPaymentMinPct}%）`);
  }

  if (incomeMan > 0 && lti > policy.ltiMax) {
    flags.push(`LTIが上限を超過（${lti}倍 > ${policy.ltiMax}倍）`);
  }

  const result = flags.length === 0 ? "PASS" : "HOLD";

  // --- required（改善目安） ---
  // DTI制約から「借入をいくらまで落とせばよいか」概算
  const maxMonthlyTotalPayMan = monthlyIncomeMan * (policy.dtiMaxPct / 100);
  const maxMortgagePayMan = maxMonthlyTotalPayMan - estOtherDebtPayMan;

  const maxPrincipalByDTI = maxMortgagePayMan > 0
    ? pvFromPmtMan(maxMortgagePayMan, policy.annualRatePct, policy.years)
    : 0;

  const reduceLoanManForDTI =
    (principalMan > 0 && maxPrincipalByDTI > 0)
      ? Math.max(0, Math.round(principalMan - maxPrincipalByDTI))
      : (principalMan > 0 && maxMortgagePayMan <= 0 ? Math.round(principalMan) : 0);

  // 頭金制約のための追加自己資金
  const extraAssets = requiredExtraAssetsForDownPayment(assetsMan, loanRequestMan, policy.downPaymentMinPct);
  const increaseAssetsManForDownPayment = Math.max(0, Math.round(extraAssets));

  // DTIが「他借入返済」で詰まっている場合の圧縮目安
  // （maxMortgagePayMan < 0 なら、まず他借入月返済を減らす必要がある）
  let reduceOtherDebtMan = 0;
  if (maxMortgagePayMan < 0 && otherDebtMan > 0) {
    const needReduceOtherPayMan = Math.abs(maxMortgagePayMan); // 万円/月
    reduceOtherDebtMan = Math.min(
      otherDebtMan,
      Math.round(needReduceOtherPayMan / policy.otherDebtPayCoeff)
    );
  }

  // --- Trace（判断理由と記録） ---
  const reason =
    result === "PASS"
      ? `${policy.bank}のPolicy Gate上は条件を満たす範囲（ただし可否の決定はしない）`
      : `${policy.bank}のPolicy Gate上で再検討が必要（ただし可否の決定はしない）`;

  const actions: string[] = [
    "条件の前提（年収・借入・自己資金）を再確認する",
    "支出変動（家計）を想定して余裕を確認する",
    "金利変動ケースも検討する",
  ];

  // HOLDの場合は“概算の目安”をTraceにも追加（UIはrequiredで表示）
  if (result === "HOLD") {
    if (reduceLoanManForDTI > 0) actions.unshift(`申込金額の見直し（概算：-${reduceLoanManForDTI}万円）`);
    if (increaseAssetsManForDownPayment > 0) actions.unshift(`自己資金の増額（概算：+${increaseAssetsManForDownPayment}万円）`);
    if (reduceOtherDebtMan > 0) actions.unshift(`他借入の圧縮（概算：-${reduceOtherDebtMan}万円）`);
  }

  const lambdaText =
    result === "PASS"
      ? `現条件では検討可能（可否は決定しない）`
      : `要再検討：${flags.join(" / ")}`;

  // --- V（LLM論点） ---
  const vision = await generateVisionPoints({
    incomeMan,
    assetsMan,
    otherDebtMan,
    loanRequestMan,
    family: body.family,
    job: body.job,
  });

  const response = {
    V: vision.points,
    Lambda: {
      method: "Policy Gate",
      ruleId: policy.ruleId,
      result,
      note: "実行時の人介在なし（ルールで確定）",
      flags: flags.length ? flags : [],
      policy: {
        bank: policy.bank,
        dtiMaxPct: policy.dtiMaxPct,
        downPaymentMinPct: policy.downPaymentMinPct,
        annualRatePct: policy.annualRatePct,
        years: policy.years,
      },
      metrics: {
        monthlyIncomeMan,
        principalMan,
        estMortgagePayMan,
        estOtherDebtPayMan,
        dtiPct,
        downPaymentPct,
        lti,
      },
      required: {
        reduceLoanManForDTI,
        increaseAssetsManForDownPayment,
        reduceOtherDebtMan,
      },
    },
    Trace: {
      reason,
      actions,
      log: {
        E: "住宅購入資金の事前検討",
        V: "返済比率 / 借入状況 / 資産構成",
        Lambda: `Policy Gate（${policy.ruleId}）: ${lambdaText}`,
        Trace: reason,
      },
    },
    meta: {
      model: vision.meta.model,
      visionNote: vision.meta.visionNote,
    },
  };

  return NextResponse.json(response);
}
