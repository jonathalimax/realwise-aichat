#!/usr/bin/env bash
set -euo pipefail

MODELS=("qwen2.5:7b-instruct-q4_K_M" "llama3.1:8b-instruct-q4_K_M")
QUESTIONS_FILE="$(dirname "$0")/pt-br-questions.json"
OUT_DIR="$(dirname "$0")/results"
mkdir -p "$OUT_DIR"

SYSTEM_PROMPT="Você é o atendente de uma imobiliária/concessionária brasileira. Responda em português brasileiro natural, direto, sem gírias de IA. Se não souber a resposta exata, diga que vai confirmar com um atendente humano."

for MODEL in "${MODELS[@]}"; do
  SAFE_NAME=$(echo "$MODEL" | tr ':/' '__')
  OUT_FILE="$OUT_DIR/${SAFE_NAME}.jsonl"
  : > "$OUT_FILE"

  python3 -c "
import json
d = json.load(open('$QUESTIONS_FILE'))
for niche, qs in d.items():
    for q in qs:
        print(json.dumps({'niche': niche, 'question': q}))
" | while IFS= read -r line; do
    Q=$(echo "$line" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['question'])")
    NICHE=$(echo "$line" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['niche'])")
    START=$(date +%s%N)
    ANSWER=$(ollama run "$MODEL" "$SYSTEM_PROMPT"$'\n\n'"Cliente: $Q" 2>/dev/null)
    END=$(date +%s%N)
    LATENCY_MS=$(( (END - START) / 1000000 ))
    python3 -c "
import json
print(json.dumps({'niche': '$NICHE', 'question': '''$Q''', 'answer': '''$ANSWER''', 'latency_ms': $LATENCY_MS}))
" >> "$OUT_FILE"
    echo "[$MODEL] ($NICHE) ${LATENCY_MS}ms :: $Q"
  done
done

echo "Done. Results in $OUT_DIR — grade manually or feed into the llm-evaluation skill for a rubric pass."
