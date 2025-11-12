<script>
	import { signUp } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let email = '';
	let password = '';
	let confirmPassword = '';
	let error = '';
	let success = false;
	let loading = false;
	let showPassword = false;
	let showConfirmPassword = false;

	// 비밀번호 일치 여부를 실시간으로 계산
	$: passwordMatchStatus = (() => {
		if (!password && !confirmPassword) {
			return null; // 아직 입력하지 않음
		}
		if (confirmPassword.length === 0) {
			return null; // 비밀번호 확인 필드가 비어있음
		}
		if (password === confirmPassword) {
			return { match: true, message: '✓ 비밀번호가 일치합니다.' };
		} else {
			return { match: false, message: '✗ 비밀번호가 일치하지 않습니다.' };
		}
	})();

	async function handleSignup() {
		if (!email || !password || !confirmPassword) {
			error = '모든 필드를 입력해주세요.';
			return;
		}

		if (password !== confirmPassword) {
			error = '비밀번호가 일치하지 않습니다.';
			return;
		}

		if (password.length < 6) {
			error = '비밀번호는 최소 6자 이상이어야 합니다.';
			return;
		}

		error = '';
		loading = true;

		const result = await signUp(email, password);

		if (result.success) {
			success = true;
			// 이메일 확인 메시지 표시 후 로그인 페이지로 이동
			setTimeout(() => {
				goto('/login');
			}, 5000);
		} else {
			error = result.error || '회원가입에 실패했습니다.';
			loading = false;
		}
	}
</script>

<div class="auth-container">
	<div class="auth-card">
		<h1>회원가입</h1>
		<p class="subtitle">새 계정을 만드세요</p>

		{#if success}
			<div class="success-message">
				<h2>✓ 회원가입 완료</h2>
				<p>회원가입이 완료되었습니다!</p>
				<p>이메일을 확인하여 계정을 활성화해주세요.</p>
				<p class="small">이메일 확인 링크를 클릭하면 자동으로 로그인됩니다.</p>
				<p class="small">잠시 후 로그인 페이지로 이동합니다...</p>
			</div>
		{:else}
			<form on:submit|preventDefault={handleSignup}>
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
							placeholder="최소 6자 이상"
							required
							disabled={loading}
							minlength="6"
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

				<div class="form-group">
					<label for="confirmPassword">비밀번호 확인</label>
					<div class="password-input-wrapper">
						<input
							id="confirmPassword"
							type={showConfirmPassword ? 'text' : 'password'}
							bind:value={confirmPassword}
							placeholder="비밀번호를 다시 입력하세요"
							required
							disabled={loading}
						/>
						<button
							type="button"
							class="password-toggle"
							on:click={() => showConfirmPassword = !showConfirmPassword}
							disabled={loading}
							aria-label={showConfirmPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
						>
							{#if showConfirmPassword}
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

				{#if passwordMatchStatus}
					<div class="password-match-message {passwordMatchStatus.match ? 'match' : 'mismatch'}">
						{passwordMatchStatus.message}
					</div>
				{/if}

				{#if error}
					<div class="error-message">{error}</div>
				{/if}

				<button type="submit" class="submit-btn" disabled={loading}>
					{loading ? '가입 중...' : '회원가입'}
				</button>
			</form>
		{/if}

		<div class="auth-footer">
			<p>이미 계정이 있으신가요? <a href="/login">로그인</a></p>
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

	.password-match-message {
		padding: 10px 12px;
		border-radius: 8px;
		font-size: 14px;
		margin-bottom: 16px;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.password-match-message.match {
		background-color: #d1fae5;
		color: #065f46;
		border: 1px solid #a7f3d0;
	}

	.password-match-message.mismatch {
		background-color: #fee2e2;
		color: #b91c1c;
		border: 1px solid #fecaca;
	}

	.error-message {
		background-color: #fee2e2;
		color: #b91c1c;
		padding: 12px;
		border-radius: 8px;
		font-size: 14px;
		margin-bottom: 16px;
	}

	.success-message {
		background-color: #d1fae5;
		color: #065f46;
		padding: 20px;
		border-radius: 8px;
		font-size: 14px;
		margin-bottom: 16px;
		text-align: center;
	}

	.success-message h2 {
		margin: 0 0 12px;
		font-size: 20px;
	}

	.success-message p {
		margin: 8px 0;
	}

	.success-message .small {
		font-size: 12px;
		color: #047857;
		margin-top: 12px;
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

