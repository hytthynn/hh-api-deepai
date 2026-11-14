'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend, errorText } from '@/src/ui/api';
import { Button, Field } from '@/src/ui/ui';

export function LoginForm({ passwordConfigured }: { passwordConfigured: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length === 0) {
      setError('Введите пароль');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiSend('/api/auth/login', 'POST', { password });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      setLoading(false);
    }
  };

  return (
    <form className="login-card" onSubmit={(event) => void submit(event)}>
      <div>
        <div className="logo" style={{ padding: 0, marginBottom: 8 }}>
          <span className="logo-mark" />
          hh-api
        </div>
        <div className="login-sub">Локальная панель управления шлюзом</div>
      </div>

      {passwordConfigured ? null : (
        <div className="error-panel">
          <div className="error-panel-text">
            <span className="error-panel-title">Пароль не задан</span>
            <span className="error-panel-message">Добавьте HH_ADMIN_PASSWORD в .env.local и перезапустите приложение.</span>
          </div>
        </div>
      )}

      <Field label="Пароль" htmlFor="password" error={error}>
        <input
          id="password"
          className={`input${error ? ' invalid' : ''}`}
          type="password"
          value={password}
          autoFocus
          autoComplete="current-password"
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError(null);
          }}
        />
      </Field>

      <Button type="submit" variant="primary" loading={loading} disabled={!passwordConfigured}>
        Войти
      </Button>
    </form>
  );
}