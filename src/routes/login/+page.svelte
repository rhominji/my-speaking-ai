<script>
	import { signIn } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	let email = '';
	let password = '';
	let error = '';
	let loading = false;
	let showPassword = false;

	async function handleLogin() {
		if (!email || !password) {
			error = '이메일과 비밀번호를 입력해주세요.';
			return;
		}

		error = '';
		loading = true;

		const result = await signIn(email, password);

		if (result.success) {
			const redirectTo = $page.url.searchParams.get('redirectTo') || '/';
			goto(redirectTo);
		} else {
			error = result.error || '로그인에 실패했습니다.';
			loading = false;
		}
	}
</script>

<div class="auth-container">
	<div class="auth-card">
		<h1>로그인</h1>
		<p class="subtitle">계정에 로그인하세요</p>

		<form on:submit|preventDefault={handleLogin}>
			<div class="form-group">
				<label for="email">이메일</label>
				<input
					id="email"
					type="email"
					bind:value={email}
					placeholder="your@email.com"
					required
					disabled={loading}
				/>
			</div>

			<div class="form-group">
				<label for="password">비밀번호</label>
				<div class="password-input-wrapper">
					<input
						id="password"
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						placeholder="비밀번호를 입력하세요"
						required
						disabled={loading}
					/>
					<button
						type="button"
						class="password-toggle"
						on:click={() => showPassword = !showPassword}
						disabled={loading}
						aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
					>
						{#if showPassword}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
								<circle cx="12" cy="12" r="3"/>
								<line x1="1" y1="1" x2="23" y2="23"/>
								<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
							</svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
								<circle cx="12" cy="12" r="3"/>
							</svg>
						{/if}
					</button>
				</div>
			</div>

			{#if error}
				<div class="error-message">{error}</div>
			{/if}

			<button type="submit" class="submit-btn" disabled={loading}>
				{loading ? '로그인 중...' : '로그인'}
			</button>
		</form>

		<div class="auth-footer">
			<p>계정이 없으신가요? <a href="/signup">회원가입</a></p>
		</div>
	</div>
</div>

<style>
	.auth-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: radial-gradient(1200px 600px at 20% -10%, #e8f0ff, transparent),
			radial-gradient(1200px 600px at 120% 110%, #e8f0ff, transparent);
	}

	.auth-card {
		width: 100%;
		max-width: 400px;
		background: white;
		border-radius: 12px;
		padding: 32px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		border: 1px solid #e5e7eb;
	}

	h1 {
		font-size: 28px;
		font-weight: 700;
		color: #0f172a;
		margin: 0 0 8px;
		text-align: center;
	}

	.subtitle {
		text-align: center;
		color: #64748b;
		margin: 0 0 24px;
		font-size: 14px;
	}

	.form-group {
		margin-bottom: 20px;
	}

	label {
		display: block;
		font-size: 14px;
		font-weight: 500;
		color: #334155;
		margin-bottom: 8px;
	}

	input {
		width: 100%;
		padding: 12px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 14px;
		transition: border-color 0.2s;
		box-sizing: border-box;
	}

	input:focus {
		outline: none;
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
	}

	input:disabled {
		background-color: #f3f4f6;
		cursor: not-allowed;
	}

	.password-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.password-input-wrapper input {
		padding-right: 44px;
	}

	.password-toggle {
		position: absolute;
		right: 12px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #64748b;
		transition: color 0.2s;
	}

	.password-toggle:hover:not(:disabled) {
		color: #334155;
	}

	.password-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error-message {
		background-color: #fee2e2;
		color: #b91c1c;
		padding: 12px;
		border-radius: 8px;
		font-size: 14px;
		margin-bottom: 16px;
	}

	.submit-btn {
		width: 100%;
		padding: 12px;
		background-color: #2563eb;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.submit-btn:hover:not(:disabled) {
		background-color: #1d4ed8;
	}

	.submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.auth-footer {
		margin-top: 24px;
		text-align: center;
		font-size: 14px;
		color: #64748b;
	}

	.auth-footer a {
		color: #2563eb;
		text-decoration: none;
		font-weight: 500;
	}

	.auth-footer a:hover {
		text-decoration: underline;
	}
</style>

