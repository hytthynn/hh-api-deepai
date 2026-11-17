'use client';

import { useState } from 'react';
import { errorText } from './api';
import { Button, Field, Modal } from './ui';

type DbImportResult = { ok: boolean; accounts: number; keys: number; requests: number };

/** SPEC §17.6 (ADR-026): full-database replacement with an explicit warning. */
export function DbImportModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DbImportResult | null>(null);

  const submit = async (): Promise<void> => {
    if (!file) {
      setError('Выберите файл снимка БД');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/db/import', { method: 'POST', body: file, cache: 'no-store' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? `Ошибка ${response.status}`);
      }
      setResult((await response.json()) as DbImportResult);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Импорт БД"
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={() => window.location.reload()}>Обновить панель</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="danger" loading={loading} disabled={!file} onClick={() => void submit()}>
              Заменить БД
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="small">
          <p>
            БД заменена: аккаунтов <span className="mono">{result.accounts}</span>, ключей{' '}
            <span className="mono">{result.keys}</span>, запросов в журнале <span className="mono">{result.requests}</span>.
          </p>
          <p className="muted">
            Ключи и настройки перенесены из файла. Если в импортированной БД был задан пароль панели, теперь действует
            он. Обновите панель, чтобы увидеть новые данные.
          </p>
        </div>
      ) : (
        <div className="stack-12">
          <div className="small">
            <p>
              Текущая БД этого экземпляра будет <strong>заменена целиком</strong>: аккаунты, ключи, настройки, модели,
              джобы и логи. Старая БД сохранится рядом как <span className="mono">hh.db.prev</span>.
            </p>
            <p className="muted">
              Файл должен быть снят кнопкой «Скачать БД» на экземпляре с тем же <span className="mono">HH_SECRET</span>.
              Пароль панели станет тем, что задан в импортированной БД (если задан). Импорт недоступен, пока выполняются
              запросы или джобы.
            </p>
          </div>
          <Field
            label="Снимок БД"
            htmlFor="db-import-file"
            hint="файл .db из «Настройки → Данные → Скачать БД» другого экземпляра"
            error={error}
          >
            <input
              id="db-import-file"
              className="input"
              type="file"
              accept=".db,application/octet-stream"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                if (error) setError(null);
              }}
            />
            {file ? (
              <div className="small faint mono" style={{ marginTop: 6 }}>
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} МБ
              </div>
            ) : null}
          </Field>
        </div>
      )}
    </Modal>
  );
}