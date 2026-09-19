# Tutor evaluation

These cases intentionally include already-correct Spanish, common errors, a meaning
contrast and a conversation. `review` describes what a language reviewer must check;
it is not a set of string matches that can certify the model.

```sh
python scripts/prepare-runtime.py --tutor-evaluation
cargo run -p fluenta-tutor --example evaluate_tutor
```

The first command explicitly downloads the optional model to the ignored evaluation
directory, not the learner's profile. The example runs the production prompt, native
process, constrained decoder and parser. It writes `artifacts/tutor-evaluation.json`.
Inspect every answer, including grammar accuracy, preservation of meaning, language,
level, concision and fabricated corrections. Run on an otherwise idle machine when
comparing latency. Repeat with authored context and learner writing before publishing a
new model recommendation; this six-case set is a smoke suite, not an educational benchmark.

The default is currently Gemma 4 E2B Q4_K_M. Its general instruction model has an
[Apache-2.0 model card](https://huggingface.co/google/gemma-4-E2B-it); the
[pinned quantization](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/tree/0314792d7f1f7e229411f620751375812bb9faf2)
is 3.11 GB. This is not a Coder edition, and there is no claim that general models contain
zero code training or a removable block of coding weights.

Qwen3 4B Instruct 2507, Qwen3.5 4B/9B, SmolLM3 3B and Gemma 4 E2B were tried locally
with quantized CPU inference. Some produced German-language failures or confidently
incorrect Spanish grammar explanations. Gemma improved latency and language adherence
when the constrained field explicitly used `explanation_de`/`explanation_en`, mapped
back into the app's stable `explanation_native` protocol. It still makes teaching errors.
Preset regressions check the actual explanation language, including the past-tense
question that previously returned Spanish in its German field. Wrong-language explanations
receive one local translation pass; this does not certify their grammar accuracy.

The app therefore calls it experimental. Only authored exercises affect progress and
review scheduling. Parser tests enforce reference whitelists and reject invalid response
shapes; those safeguards do not prove the grammatical accuracy of accepted text.
