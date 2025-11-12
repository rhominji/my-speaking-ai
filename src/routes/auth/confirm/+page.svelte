<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { supabase } from '$lib/supabase.js';
	import { user } from '$lib/auth.js';

	let loading = true;
	let error = '';
	let success = false;

	onMount(async () => {
		try {
			// Supabase는 이메일 확인 링크를 클릭하면 자동으로 세션을 설정합니다
			// 먼저 현재 세션 확인
			const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
			
			if (currentSession?.user) {
				// 이미 인증된 사용자
				success = true;
				user.set(currentSession.user);
				setTimeout(() => goto('/'), 2000);
				return;
			}

			// URL에서 토큰 해시와 타입 추출 (Supabase가 URL에 추가)
			const hashParams = new URLSearchParams($page.url.hash.substring(1));
			const queryParams = $page.url.searchParams;
			
			const tokenHash = hashParams.get('token_hash') || queryParams.get('token_hash');
			const type = hashParams.get('type') || queryParams.get('type');

			if (tokenHash && type) {
				// 토큰이 있으면 OTP 확인
				const { data, error: confirmError } = await supabase.auth.verifyOtp({
					token_hash: tokenHash,
					type: type
				});

				if (confirmError) {
					error = confirmError.message || '이메일 인증에 실패했습니다.';
					loading = false;
					return;
				}

				if (data?.user) {
					success = true;
					user.set(data.user);
					setTimeout(() => goto('/'), 2000);
					return;
				}
			}

			// URL 파라미터가 없고 세션도 없으면 에러
			error = '인증 정보가 없습니다. 이메일 링크가 만료되었거나 잘못되었을 수 있습니다.';
			loading = false;
		} catch (err) {
			error = err?.message || '인증 처리 중 오류가 발생했습니다.';
			loading = false;
		}
	});
</script>

<div class="auth-container">
	<div class="auth-card">
		{#if loading}
			<div class="loading-message">
				<div class="spinner"></div>
				<p>이메일 인증을 처리하고 있습니다...</p>
			</div>
		{:else if success}
			<div class="success-message">
				<h2>✓ 이메일 인증 완료</h2>
				<p>이메일 인증이 성공적으로 완료되었습니다.</p>
				<p>잠시 후 메인 페이지로 이동합니다...</p>
			</div>
		{:else if error}
			<div class="error-message">
				<h2>✗ 인증 실패</h2>
				<p>{error}</p>
				<div class="actions">
					<a href="/login" class="btn">로그인 페이지로 이동</a>
					<a href="/signup" class="btn btn-secondary">회원가입 다시 시도</a>
				</div>
			</div>
		{/if}
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
		text-align: center;
	}

	.loading-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #e5e7eb;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.success-message h2 {
		color: #065f46;
		margin: 0 0 12px;
		font-size: 24px;
	}

	.success-message p {
		color: #64748b;
		margin: 8px 0;
	}

	.error-message h2 {
		color: #b91c1c;
		margin: 0 0 12px;
		font-size: 24px;
	}

	.error-message p {
		color: #64748b;
		margin: 8px 0 24px;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 24px;
	}

	.btn {
		padding: 12px 24px;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
		transition: all 0.2s;
		display: block;
	}

	.btn {
		background-color: #2563eb;
		color: white;
	}

	.btn:hover {
		background-color: #1d4ed8;
	}

	.btn-secondary {
		background-color: #f3f4f6;
		color: #334155;
	}

	.btn-secondary:hover {
		background-color: #e5e7eb;
	}
</style>

