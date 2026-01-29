import { NextResponse } from "next/server";

type Input = {
  age?: number;
  job?: string;
  incomeMan?: number;       // 年収（万円）
  family?: string;
  assetsMan?: number;       // 自己資金（万円）
  otherDebtMan?: number;    // 他の借入（万円）
  loanRequestMan?: number;  // 申込金額（万円）
};

function toBullets(text: string): string[] {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const bullets = lines
    .map((l) => l.replace(/^[-*•・]\s*/, "").trim())
    .filter((l) => l.length >= 4);

  return bullets.slice(0, 4);
}

// ---- ここから：架空銀行A（Demo）ポリシー（数値固定） ----
const BANK_POLICY = {
  name: "仮想銀行A（Demo）",
  mortgage: {
    annualRate: 0.015, // 1.5%（固定・デモ）
    years: 35,         // 35年（固定・デモ）
  },
  thresholds: {
    dtiMaxPct: 35,      // 返済負担率上限（DTI）
    downPaymentMinPct: 10, // 自己資金比率（頭金比率）最低
    ltiMax: 7,          // 申込金額 / 年収 上限（簡易）
    otherDebtMaxIncomeRatio: 0.5, // 他借入 / 年収 上限（簡易）
  },
  otherDebt: {
    // 他借入の月返済額（簡易換算）：残高×3%÷12（デモ）
    annualPaymentRatio: 0.03,
  },
};

function monthlyPaymentMan(principalMan: number, annualRate: number, years: number) {
  // 元利均等返済の概算（月返済額、単位：万円/月）
  // principalMan: 万円
  const r = annualRate / 12;
  const n = years * 12;

  if (principalMan <= 0) return 0;
  if (r <= 0) return principalMan / n;

  const pow = Math.pow(1 + r, n);
  return principalMan * (r * pow) / (pow - 1);
}

function principalFromMonthlyPaymentMan(paymentMan: number, annualRate: number, years: number) {
  // 月返済額→元本の逆算（概算、単位：万円）
  const r = annualRate / 12;
  const n = years * 12;

  if (paymentMan <= 0) return 0;
  if (r <= 0) return paymentMan * n;

  const pow = Math.pow(1 + r, n);
  return paymentMan * (pow - 1) / (r * pow);
}

function roundUpMan(x: number, stepMan = 10) {
  // 万円単位で切り上げ（デモなので分かりやすく）
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.ceil(x / stepMan) * stepMan);
}

function pct(x: number) {
  if (!isFinite(x)) return 0;
  return Math.round(x * 10) / 10; // 小数1桁
}

function policyGate(input: Required<Pick<Input, "incomeMan" | "loanRequestMan" | "otherDebtMan" | "assetsMan">>) {
  // Λ：LLMに判定させず、銀行ポリシー（ルール）で確定する
  const { incomeMan, loanRequestMan, otherDebtMan, assetsMan } = input;

  const monthlyIncomeMan = incomeMan / 12;

  // 住宅ローン元本は「申込金額 - 自己資金」の想定（デモ）
  const principalMan = Math.max(0, loanRequestMan - assetsMan);

  const estMortgagePayMan = monthlyPaymentMan(
    principalMan,
    BANK_POLICY.mortgage.annualRate,
    BANK_POLICY.mortgage.years
  );

  const estOtherDebtPayMan = otherDebtMan * (BANK_POLICY.otherDebt.annualPaymentRatio / 12);

  const dtiPct = monthlyIncomeMan > 0
    ? ((estMortgagePayMan + estOtherDebtPayMan) / monthlyIncomeMan) * 100
    : 0;

  const downPaymentPct = loanRequestMan > 0 ? (assetsMan / loanRequestMan) * 100 : 0;
  const lti = incomeMan > 0 ? (loanRequestMan / incomeMan) : 0;
  const otherDebtIncomeRatio = incomeMan > 0 ? (otherDebtMan / incomeMan) : 0;

  const flags: string[] = [];

  if (dtiPct > BANK_POLICY.thresholds.dtiMaxPct) {
    flags.push(`返済負担率（DTI）が上限 ${BANK_POLICY.thresholds.dtiMaxPct}% を超過（推定 ${pct(dtiPct)}%）`);
  }
  if (downPaymentPct < BANK_POLICY.thresholds.downPaymentMinPct) {
    flags.push(`自己資金比率が最低 ${BANK_POLICY.thresholds.downPaymentMinPct}% 未満（推定 ${pct(downPaymentPct)}%）`);
  }
  if (lti > BANK_POLICY.thresholds.ltiMax) {
    flags.push(`申込金額/年収（LTI）が上限 ${BANK_POLICY.thresholds.ltiMax}倍 を超過（推定 ${pct(lti)}倍）`);
  }
  if (otherDebtIncomeRatio > BANK_POLICY.thresholds.otherDebtMaxIncomeRatio) {
    flags.push(`他借入/年収が上限 ${BANK_POLICY.thresholds.otherDebtMaxIncomeRatio}倍 を超過（推定 ${pct(otherDebtIncomeRatio)}倍）`);
  }

  const result = flags.length > 0 ? "HOLD" : "PASS";

  // ---- 改善量（あといくら）を計算 ----
  // 1) DTI改善：上限に収めるために必要な「月返済削減」→「元本削減」→「申込金額削減」
  const maxTotalPayMan = monthlyIncomeMan * (BANK_POLICY.thresholds.dtiMaxPct / 100);
  const currentTotalPayMan = estMortgagePayMan + estOtherDebtPayMan;

  const needReducePayMan = Math.max(0, currentTotalPayMan - maxTotalPayMan);
  const needReducePrincipalMan = needReducePayMan > 0
    ? principalFromMonthlyPaymentMan(needReducePayMan, BANK_POLICY.mortgage.annualRate, BANK_POLICY.mortgage.years)
    : 0;

  // 申込金額を下げる場合は「元本削減 ≒ 申込金額削減」として提示（デモ）
  const reduceLoanManForDTI = roundUpMan(needReducePrincipalMan, 10);

  // 2) 頭金比率改善：最低比率にするための必要自己資金
  const requiredAssetsMan = loanRequestMan * (BANK_POLICY.thresholds.downPaymentMinPct / 100);
  const increaseAssetsMan = roundUpMan(requiredAssetsMan - assetsMan, 10);

  // 3) 他借入比率改善：上限まで圧縮する目安
  const maxOtherDebtMan = incomeMan * BANK_POLICY.thresholds.otherDebtMaxIncomeRatio;
  const reduceOtherDebtMan = roundUpMan(otherDebtMan - maxOtherDebtMan, 10);

  const reason =
    result === "HOLD"
      ? "架空銀行AのPolicy Gate条件により、追加の再検討が必要（可否は決定しない）"
      : "架空銀行AのPolicy Gate上は条件を満たす範囲（ただし可否の決定はしない）";

  // Ǝでそのまま表示できる「具体アクション」を作る
  const actions: string[] = [];

  if (result === "HOLD") {
    if (reduceLoanManForDTI > 0) actions.push(`申込金額を約 ${reduceLoanManForDTI} 万円下げる（DTI目標 ${BANK_POLICY.thresholds.dtiMaxPct}%）`);
    if (increaseAssetsMan > 0) actions.push(`自己資金を約 ${increaseAssetsMan} 万円増やす（頭金 ${BANK_POLICY.thresholds.downPaymentMinPct}% 目標）`);
    if (reduceOtherDebtMan > 0) actions.push(`他の借入を約 ${reduceOtherDebtMan} 万円圧縮する（比率上限 ${BANK_POLICY.thresholds.otherDebtMaxIncomeRatio}倍）`);
    if (actions.length === 0) actions.push("条件の前提（年収・借入・自己資金）を再確認する");
  } else {
    actions.push("条件の前提（年収・借入・自己資金）を再確認する");
    actions.push("支出変動（家計）を想定して余裕を確認する");
    actions.push("金利変動ケースも検討する");
  }

  return {
    method: "Policy Gate",
    ruleId: "MORTGAGE_STD_001",
    result,
    flags,
    reason,
    actions,
    policy: {
      bank: BANK_POLICY.name,
      dtiMaxPct: BANK_POLICY.thresholds.dtiMaxPct,
      downPaymentMinPct: BANK_POLICY.thresholds.downPaymentMinPct,
      annualRatePct: BANK_POLICY.mortgage.annualRate * 100,
      years: BANK_POLICY.mortgage.years,
    },
    metrics: {
      monthlyIncomeMan: pct(monthlyIncomeMan),
      principalMan: pct(principalMan),
      estMortgagePayMan: pct(estMortgagePayMan),
      estOtherDebtPayMan: pct(estOtherDebtPayMan),
      dtiPct: pct(dtiPct),
      downPaymentPct: pct(downPaymentPct),
      lti: pct(lti),
    },
    required: {
      reduceLoanManForDTI: reduceLoanManForDTI,     // DTI改善のための目安（万円）
      increaseAssetsManForDownPayment: increaseAssetsMan, // 頭金改善のための目安（万円）
      reduceOtherDebtMan: reduceOtherDebtMan,       // 他借入比率改善の目安（万円）
    },
  };
}

async function generateVisionWithLLM(input: Input) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const fallback = {
    bullets: [
      "返済負担率に関する論点（無理のない範囲か）",
      "他の借入による影響（返済余力への圧迫）",
      "自己資金比率の評価（安全余裕・下振れ耐性）",
      "家族構成による将来支出見込み（教育費・生活変動）",
    ],
    raw: "",
    usedModel: model,
    note: "",
  };

  if (!apiKey) return { ...fallback, note: "OPENAI_API_KEY 未設定のため固定文を返却" };

  const system = `
あなたは金融AIの「判断構造デモ」における V – Vision を生成します。

重要ルール:
- 可否（承認/否決）や、HOLD/PASS の判断は絶対にしない（それはΛでルールが行う）
- 数値の断定（例: 返済比率が何%）はしない（数値はΛのルール計算で表示する）
- 出力は「論点」だけを箇条書き4つ（日本語、各1行）
- 断定口調を避け、「〜に関する論点」「〜の影響」などに留める
`.trim();

  const user = `
入力（E – Origin）:
- 年齢: ${input.age ?? "未入力"}
- 職業: ${input.job ?? "未入力"}
- 年収(万円): ${input.incomeMan ?? "未入力"}
- 家族構成: ${input.family ?? "未入力"}
- 自己資金(万円): ${input.assetsMan ?? "未入力"}
- 他の借入(万円): ${input.otherDebtMan ?? "未入力"}
- 申込金額(万円): ${input.loanRequestMan ?? "未入力"}

この入力に対して、判断前に検討すべき「論点」を4つ、箇条書きで出してください。
`.trim();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 220,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { ...fallback, raw: errText, note: `OpenAI API error: ${res.status}` };
  }

  const data = await res.json();
  const raw: string = data?.choices?.[0]?.message?.content ?? "";
  const bullets = toBullets(raw);

  return {
    bullets: bullets.length ? bullets : fallback.bullets,
    raw,
    usedModel: model,
    note: "LLMで生成",
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Input;

    const vision = await generateVisionWithLLM(body);

    const incomeMan = Number(body.incomeMan ?? 0);
    const loanRequestMan = Number(body.loanRequestMan ?? 0);
    const otherDebtMan = Number(body.otherDebtMan ?? 0);
    const assetsMan = Number(body.assetsMan ?? 0);

    const lambda = policyGate({
      incomeMan,
      loanRequestMan,
      otherDebtMan,
      assetsMan,
    });

    const trace = {
      reason: lambda.reason,
      actions: lambda.actions,
      log: {
        E: "住宅購入資金の事前検討",
        V: "返済比率 / 借入状況 / 資産構成",
        Lambda: `${lambda.method} (${lambda.ruleId})`,
        Trace: lambda.result === "HOLD"
          ? "現条件では判断保留"
          : "現条件では検討可能（可否は決定しない）",
      },
    };

    return NextResponse.json({
      V: vision.bullets,
      Lambda: {
        method: lambda.method,
        ruleId: lambda.ruleId,
        result: lambda.result,
        note: "実行時の人介在なし（ルールで確定）",
        flags: lambda.flags,
        policy: lambda.policy,
        metrics: lambda.metrics,
        required: lambda.required,
      },
      Trace: trace,
      meta: {
        model: vision.usedModel,
        visionNote: vision.note,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Bad Request", detail: String(e?.message ?? e) },
      { status: 400 }
    );
  }
}
