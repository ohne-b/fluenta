//! Deterministic answer evaluation and review scheduling. No I/O or UI dependencies.
use fluenta_contracts::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct InvalidAnswer(pub &'static str);

pub struct EvidenceContext<'a> {
    pub hints_used: bool,
    /// Supplied only after the service verifies the recognition's session and step.
    pub recognized_transcript: Option<&'a str>,
}

#[derive(Debug)]
pub struct Evaluation {
    pub outcome: Outcome,
    pub evidence: Evidence,
    pub explanation: Option<ContentRef>,
    pub rubric: Option<ContentRef>,
    pub message_key: &'static str,
}

pub fn normalize(text: &str, operations: &[Normalization]) -> String {
    operations
        .iter()
        .fold(text.to_owned(), |text, operation| match operation {
            Normalization::UnicodeNfc => text.nfc().collect(),
            Normalization::Trim => text.trim().to_owned(),
            Normalization::CollapseWhitespace => {
                text.split_whitespace().collect::<Vec<_>>().join(" ")
            }
            Normalization::IgnoreCase => text.to_lowercase(),
            Normalization::IgnoreTerminalPunctuation => {
                text.trim_end_matches(['.', '!', '?', '…']).to_owned()
            }
        })
}

pub fn evaluate(
    task: &Task,
    answer: &Answer,
    context: EvidenceContext<'_>,
) -> Result<Evaluation, InvalidAnswer> {
    let recall = if context.hints_used {
        Evidence::AssistedRecall
    } else {
        Evidence::UnaidedRecall
    };
    let marked = |correct, evidence, explanation: Option<ContentRef>| Evaluation {
        outcome: if correct {
            Outcome::Correct
        } else {
            Outcome::Incorrect
        },
        evidence,
        explanation,
        rubric: None,
        message_key: if correct {
            "answer.correct"
        } else {
            "answer.compare"
        },
    };
    match (task, answer) {
        (Task::Explanation { .. }, Answer::Acknowledged) => Ok(Evaluation {
            outcome: Outcome::Completed,
            evidence: Evidence::None,
            explanation: None,
            rubric: None,
            message_key: "answer.explored",
        }),
        (
            Task::Choice {
                options,
                correct_ids,
                explanation,
            },
            Answer::Choice { selected_ids },
        ) => {
            let selected: BTreeSet<_> = selected_ids.iter().collect();
            let allowed: BTreeSet<_> = options.iter().map(|x| &x.id).collect();
            if selected.is_empty()
                || selected.len() != selected_ids.len()
                || !selected.is_subset(&allowed)
                || (correct_ids.len() == 1 && selected.len() != 1)
            {
                return Err(InvalidAnswer("answer.invalid_selection"));
            }
            Ok(marked(
                selected == correct_ids.iter().collect(),
                if context.hints_used {
                    Evidence::AssistedRecall
                } else {
                    Evidence::None
                },
                Some(explanation.clone()),
            ))
        }
        (
            Task::Order {
                items,
                accepted_orders,
                explanation,
            },
            Answer::Order { ordered_ids },
        ) => {
            let allowed: BTreeSet<_> = items.iter().map(|x| &x.id).collect();
            if ordered_ids.len() != items.len()
                || ordered_ids.iter().collect::<BTreeSet<_>>() != allowed
            {
                return Err(InvalidAnswer("answer.invalid_order"));
            }
            Ok(marked(
                accepted_orders.contains(ordered_ids),
                if context.hints_used {
                    Evidence::AssistedRecall
                } else {
                    Evidence::None
                },
                Some(explanation.clone()),
            ))
        }
        (
            Task::ShortAnswer {
                target,
                inputs,
                accepted,
                normalization,
                mistakes,
                explanation,
                ..
            },
            answer,
        ) => {
            let (text, evidence) = match answer {
                Answer::Typed { text } if inputs.contains(&InputMode::Keyboard) => {
                    (text.as_str(), recall)
                }
                Answer::Voice { confirmed_text, .. }
                    if *target != TextTarget::Orthography
                        && inputs.contains(&InputMode::Microphone) =>
                {
                    let recognized = context
                        .recognized_transcript
                        .ok_or(InvalidAnswer("answer.recognition_missing"))?;
                    let edited = confirmed_text.trim().nfc().collect::<String>()
                        != recognized.trim().nfc().collect::<String>();
                    (
                        confirmed_text.as_str(),
                        if edited {
                            Evidence::EditedTranscript
                        } else if context.hints_used {
                            Evidence::AssistedRecall
                        } else {
                            Evidence::RecognizedContent
                        },
                    )
                }
                _ => return Err(InvalidAnswer("answer.input_not_allowed")),
            };
            if text.len() > 8000 {
                return Err(InvalidAnswer("answer.too_long"));
            }
            let value = normalize(text, normalization);
            if value.trim().is_empty() {
                return Err(InvalidAnswer("answer.empty"));
            }
            let correct = accepted
                .iter()
                .any(|candidate| normalize(candidate, normalization) == value);
            let feedback = if correct {
                explanation.clone()
            } else {
                mistakes
                    .iter()
                    .find(|mistake| {
                        mistake
                            .answers
                            .iter()
                            .any(|candidate| normalize(candidate, normalization) == value)
                    })
                    .map(|x| x.feedback.clone())
                    .unwrap_or_else(|| explanation.clone())
            };
            Ok(marked(correct, evidence, Some(feedback)))
        }
        (
            Task::Writing {
                min_words,
                max_words,
                rubric,
                ..
            },
            Answer::Writing { text },
        ) => {
            let words = text.split_whitespace().count();
            if words < *min_words as usize
                || words > max_words.get() as usize
                || text.len() > 50_000
            {
                return Err(InvalidAnswer("answer.word_count"));
            }
            Ok(Evaluation {
                outcome: Outcome::NeedsSelfReview,
                evidence: Evidence::SelfAssessment,
                explanation: None,
                rubric: Some(rubric.clone()),
                message_key: "answer.self_review",
            })
        }
        (Task::Speaking { rubric, .. }, Answer::Recording { .. }) => Ok(Evaluation {
            outcome: Outcome::NeedsSelfReview,
            evidence: Evidence::SelfAssessment,
            explanation: None,
            rubric: Some(rubric.clone()),
            message_key: "answer.self_review",
        }),
        _ => Err(InvalidAnswer("answer.input_not_allowed")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewMemory {
    pub stability: f32,
    pub difficulty: f32,
    pub due_ms: i64,
    pub last_review_ms: i64,
}

pub fn schedule(
    previous: Option<&ReviewMemory>,
    outcome: Outcome,
    evidence: Evidence,
    now_ms: i64,
) -> Result<Option<ReviewMemory>, String> {
    if !matches!(outcome, Outcome::Correct | Outcome::Incorrect)
        || !matches!(evidence, Evidence::UnaidedRecall | Evidence::AssistedRecall)
    {
        return Ok(None);
    }
    // Repeating an already exposed item in the same minute must not inflate its schedule.
    if previous.is_some_and(|state| now_ms.saturating_sub(state.last_review_ms) < 60_000) {
        return Ok(None);
    }
    let fsrs = fsrs::FSRS::new(&[]).map_err(|e| e.to_string())?;
    let memory = previous.map(|state| fsrs::MemoryState {
        stability: state.stability,
        difficulty: state.difficulty,
    });
    let days = previous.map_or(0, |state| {
        (now_ms.saturating_sub(state.last_review_ms).max(0) / 86_400_000).min(u32::MAX as i64)
            as u32
    });
    let states = fsrs
        .next_states(memory, 0.9, days)
        .map_err(|e| e.to_string())?;
    let state =
        if matches!(outcome, Outcome::Correct) && matches!(evidence, Evidence::UnaidedRecall) {
            states.good
        } else {
            states.again
        };
    let delay = (f64::from(state.interval) * 86_400_000.0)
        .round()
        .clamp(600_000.0, 36500.0 * 86_400_000.0) as i64;
    Ok(Some(ReviewMemory {
        stability: state.memory.stability,
        difficulty: state.memory.difficulty,
        due_ms: now_ms.saturating_add(delay),
        last_review_ms: now_ms,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task() -> Task {
        Task::ShortAnswer {
            language: Language::Es,
            target: TextTarget::Orthography,
            inputs: vec![InputMode::Keyboard],
            accepted: vec!["estudié".into()],
            normalization: vec![Normalization::UnicodeNfc, Normalization::Trim],
            mistakes: vec![],
            explanation: ContentRef {
                id: "explanation.test".to_owned().try_into().unwrap(),
                revision: 1.try_into().unwrap(),
            },
        }
    }
    #[test]
    fn accents_modes_and_assistance_are_not_interchangeable() {
        let task = task();
        for (value, correct) in [
            ("estudie\u{301}", true),
            ("estudie", false),
            (" estudié ", true),
            ("Estudié.", false),
        ] {
            let result = evaluate(
                &task,
                &Answer::Typed { text: value.into() },
                EvidenceContext {
                    hints_used: false,
                    recognized_transcript: None,
                },
            )
            .unwrap();
            assert_eq!(matches!(result.outcome, Outcome::Correct), correct);
        }
        assert!(
            evaluate(
                &task,
                &Answer::Voice {
                    recognition_id: "r".to_owned().try_into().unwrap(),
                    confirmed_text: "estudié".into()
                },
                EvidenceContext {
                    hints_used: false,
                    recognized_transcript: Some("estudié")
                }
            )
            .is_err()
        );
        let result = evaluate(
            &task,
            &Answer::Typed {
                text: "estudié".into(),
            },
            EvidenceContext {
                hints_used: true,
                recognized_transcript: None,
            },
        )
        .unwrap();
        assert!(matches!(result.evidence, Evidence::AssistedRecall));
    }
    #[test]
    fn fsrs_preserves_evidence_and_clock_boundaries() {
        let now = 1_800_000_000_000;
        let good = schedule(None, Outcome::Correct, Evidence::UnaidedRecall, now)
            .unwrap()
            .unwrap();
        let assisted = schedule(None, Outcome::Correct, Evidence::AssistedRecall, now)
            .unwrap()
            .unwrap();
        assert!(good.due_ms > assisted.due_ms && assisted.due_ms > now);
        assert!(
            schedule(
                Some(&good),
                Outcome::Correct,
                Evidence::UnaidedRecall,
                now - 1000
            )
            .unwrap()
            .is_none()
        );
        assert!(
            schedule(None, Outcome::Correct, Evidence::RecognizedContent, now)
                .unwrap()
                .is_none()
        );
    }
}
