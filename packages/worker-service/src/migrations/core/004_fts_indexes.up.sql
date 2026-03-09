CREATE VIRTUAL TABLE IF NOT EXISTS _prompts_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  prompt_preview,
  intent_category,
  content=_prompts,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS _observations_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  content,
  category,
  content=_observations,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS _agent_errors_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  message,
  content=_agent_errors,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS _sessions_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  agent,
  summary,
  content=_sessions,
  content_rowid=rowid,
  tokenize='porter unicode61'
);

-- Sync triggers for _prompts_fts
CREATE TRIGGER IF NOT EXISTS _prompts_fts_insert AFTER INSERT ON _prompts BEGIN
  INSERT INTO _prompts_fts(rowid, id, project_id, prompt_preview, intent_category)
  VALUES (new.rowid, new.id, new.project_id, new.prompt_preview, new.intent_category);
END;
CREATE TRIGGER IF NOT EXISTS _prompts_fts_delete BEFORE DELETE ON _prompts BEGIN
  INSERT INTO _prompts_fts(_prompts_fts, rowid, id, project_id, prompt_preview, intent_category)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.prompt_preview, old.intent_category);
END;
CREATE TRIGGER IF NOT EXISTS _prompts_fts_update AFTER UPDATE ON _prompts BEGIN
  INSERT INTO _prompts_fts(_prompts_fts, rowid, id, project_id, prompt_preview, intent_category)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.prompt_preview, old.intent_category);
  INSERT INTO _prompts_fts(rowid, id, project_id, prompt_preview, intent_category)
  VALUES (new.rowid, new.id, new.project_id, new.prompt_preview, new.intent_category);
END;

-- Sync triggers for _observations_fts
CREATE TRIGGER IF NOT EXISTS _obs_fts_insert AFTER INSERT ON _observations BEGIN
  INSERT INTO _observations_fts(rowid, id, project_id, content, category)
  VALUES (new.rowid, new.id, new.project_id, new.content, new.category);
END;
CREATE TRIGGER IF NOT EXISTS _obs_fts_delete BEFORE DELETE ON _observations BEGIN
  INSERT INTO _observations_fts(_observations_fts, rowid, id, project_id, content, category)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.content, old.category);
END;
CREATE TRIGGER IF NOT EXISTS _obs_fts_update AFTER UPDATE ON _observations BEGIN
  INSERT INTO _observations_fts(_observations_fts, rowid, id, project_id, content, category)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.content, old.category);
  INSERT INTO _observations_fts(rowid, id, project_id, content, category)
  VALUES (new.rowid, new.id, new.project_id, new.content, new.category);
END;

-- Sync triggers for _agent_errors_fts
CREATE TRIGGER IF NOT EXISTS _errors_fts_insert AFTER INSERT ON _agent_errors BEGIN
  INSERT INTO _agent_errors_fts(rowid, id, project_id, message)
  VALUES (new.rowid, new.id, new.project_id, new.message);
END;
CREATE TRIGGER IF NOT EXISTS _errors_fts_delete BEFORE DELETE ON _agent_errors BEGIN
  INSERT INTO _agent_errors_fts(_agent_errors_fts, rowid, id, project_id, message)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.message);
END;

-- Sync triggers for _sessions_fts
CREATE TRIGGER IF NOT EXISTS _sessions_fts_insert AFTER INSERT ON _sessions BEGIN
  INSERT INTO _sessions_fts(rowid, id, project_id, agent, summary)
  VALUES (new.rowid, new.id, new.project_id, new.agent, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS _sessions_fts_delete BEFORE DELETE ON _sessions BEGIN
  INSERT INTO _sessions_fts(_sessions_fts, rowid, id, project_id, agent, summary)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.agent, old.summary);
END;
CREATE TRIGGER IF NOT EXISTS _sessions_fts_update AFTER UPDATE ON _sessions BEGIN
  INSERT INTO _sessions_fts(_sessions_fts, rowid, id, project_id, agent, summary)
  VALUES ('delete', old.rowid, old.id, old.project_id, old.agent, old.summary);
  INSERT INTO _sessions_fts(rowid, id, project_id, agent, summary)
  VALUES (new.rowid, new.id, new.project_id, new.agent, new.summary);
END;
