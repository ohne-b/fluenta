use super::*;
impl Store {
    pub fn tutor_threads(&self) -> Result<Vec<TutorThread>> {
        let mut result = Vec::new();
        for row in self.db.prepare("SELECT id,title,source_language,updated_ms FROM tutor_threads ORDER BY updated_ms DESC LIMIT 100")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?)))? {
            let (id,title,language,updated)=row?;result.push(TutorThread{id:id.try_into().map_err(Error::Invalid)?,title,source_language:from_json(&format!("\"{language}\""))?,updated_ms:updated as f64});
        }
        Ok(result)
    }
    pub fn tutor_thread(&self, id: &Id) -> Result<ThreadDetail> {
        let row = self
            .db
            .query_row(
                "SELECT title,source_language,updated_ms FROM tutor_threads WHERE id=?1",
                [id.as_str()],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or(Error::NotFound)?;
        let thread = TutorThread {
            id: id.clone(),
            title: row.0,
            source_language: from_json(&format!("\"{}\"", row.1))?,
            updated_ms: row.2 as f64,
        };
        let mut turns = Vec::new();
        for row in self.db.prepare("SELECT role,text,explanation,references_json FROM (SELECT id,role,text,explanation,references_json FROM tutor_turns WHERE thread_id=?1 ORDER BY id DESC LIMIT 100) ORDER BY id")?.query_map([id.as_str()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,String>(3)?)))? {
            let (role,text,explanation,refs)=row?;turns.push(TutorTurn{role,text,explanation,references:from_json(&refs)?});
        }
        Ok(ThreadDetail { thread, turns })
    }
    pub fn save_tutor_exchange(
        &mut self,
        id: Option<&Id>,
        locale: SourceLanguage,
        message: &str,
        reply: &TutorReply,
        refs: Vec<ContentRef>,
        now: i64,
    ) -> Result<Id> {
        let id = id.cloned().unwrap_or_else(new_id);
        let tx = self.db.transaction()?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT source_language FROM tutor_threads WHERE id=?1",
                [id.as_str()],
                |r| r.get(0),
            )
            .optional()?;
        if existing.as_deref().is_some_and(|v| v != locale.code()) {
            return Err(Error::Invalid("tutor.language_mismatch".into()));
        }
        tx.execute("INSERT INTO tutor_threads(id,title,source_language,updated_ms) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET updated_ms=excluded.updated_ms",params![id.as_str(),message.chars().take(65).collect::<String>(),locale.code(),now])?;
        tx.execute("INSERT INTO tutor_turns(thread_id,role,text,references_json) VALUES(?1,'user',?2,'[]')",params![id.as_str(),message])?;
        tx.execute("INSERT INTO tutor_turns(thread_id,role,text,explanation,references_json) VALUES(?1,'assistant',?2,?3,?4)",params![id.as_str(),reply.reply_es,reply.explanation_native,json(&refs)?])?;
        tx.commit()?;
        Ok(id)
    }
    pub fn delete_tutor_thread(&self, id: &Id) -> Result<()> {
        self.db
            .execute("DELETE FROM tutor_threads WHERE id=?1", [id.as_str()])?;
        Ok(())
    }
}
