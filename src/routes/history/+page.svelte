<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { user } from '$lib/auth.js';
	import { getConversationHistory } from '$lib/conversation.js';

	let sessions = [];
	let loading = true;
	let error = '';

	function formatDate(dateString) {
		const date = new Date(dateString);
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return '방금 전';
		if (diffMins < 60) return `${diffMins}분 전`;
		if (diffHours < 24) return `${diffHours}시간 전`;
		if (diffDays < 7) return `${diffDays}일 전`;
		
		return date.toLocaleDateString('ko-KR', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatSessionTime(startTime, endTime) {
		const start = new Date(startTime);
		const end = new Date(endTime);
		const duration = Math.floor((end - start) / 60000); // 분 단위

		return `${start.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} (${duration}분)`;
	}

	onMount(async () => {
		if (!$user) {
			goto('/login');
			return;
		}

		loading = true;
		const result = await getConversationHistory($user.id);
		
		if (result.success) {
			sessions = result.data;
		} else {
			error = result.error || '대화 기록을 불러오는 중 오류가 발생했습니다.';
		}
		
		loading = false;
	});
</script>

<main class="container">
	<header class="header">
		<h1>📝 대화 기록</h1>
		<p class="subtitle">나의 영어 회화 기록을 확인하세요.</p>
	</header>

	<div class="actions">
		<a href="/" class="back-link">← 메인으로 돌아가기</a>
	</div>

	{#if loading}
		<div class="loading">로딩 중...</div>
	{:else if error}
		<div class="error-message">{error}</div>
	{:else if sessions.length === 0}
		<div class="empty-state">
			<p>아직 저장된 대화 기록이 없습니다.</p>
			<a href="/" class="primary-button">대화 시작하기</a>
		</div>
	{:else}
		<div class="sessions-list">
			{#each sessions as session (session.id)}
				<div class="session-card">
					<div class="session-header">
						<h3>세션 {sessions.length - sessions.indexOf(session)}</h3>
						<span class="session-time">
							{formatSessionTime(session.startTime, session.endTime)}
						</span>
						<span class="session-date">
							{formatDate(new Date(session.startTime).toISOString())}
						</span>
					</div>
					<div class="session-content">
						{#each session.records as record (record.id)}
							<div class="conversation-item">
								<div class="user-message">
									<div class="message-label">나</div>
									<div class="message-content">{record.user_message}</div>
								</div>
								{#if record.assistant_reply}
									<div class="assistant-message">
										<div class="message-label">AI</div>
										<div class="message-content">{record.assistant_reply}</div>
									</div>
								{/if}
								<div class="message-time">
									{formatDate(record.created_at)}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</main>

<style>
	.container {
		min-height: 100vh;
		padding: 40px 16px;
		background: radial-gradient(1200px 600px at 20% -10%, #e8f0ff, transparent),
			radial-gradient(1200px 600px at 120% 110%, #e8f0ff, transparent);
		max-width: 900px;
		margin: 0 auto;
	}

	.header {
		text-align: center;
		margin-bottom: 32px;
	}

	.header h1 {
		font-size: 32px;
		margin: 0 0 6px;
		color: #0f172a;
	}

	.subtitle {
		color: #475569;
		margin: 0;
	}

	.actions {
		margin-bottom: 24px;
	}

	.back-link {
		color: #2563eb;
		text-decoration: none;
		font-size: 14px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.back-link:hover {
		text-decoration: underline;
	}

	.loading {
		text-align: center;
		padding: 40px;
		color: #64748b;
	}

	.error-message {
		background: #fee2e2;
		color: #b91c1c;
		padding: 16px;
		border-radius: 8px;
		text-align: center;
	}

	.empty-state {
		text-align: center;
		padding: 60px 20px;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
	}

	.empty-state p {
		color: #64748b;
		margin-bottom: 24px;
	}

	.primary-button {
		display: inline-block;
		background: #2563eb;
		color: white;
		padding: 12px 24px;
		border-radius: 8px;
		text-decoration: none;
		font-weight: 600;
	}

	.primary-button:hover {
		background: #1d4ed8;
	}

	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.session-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 20px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.session-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 20px;
		padding-bottom: 16px;
		border-bottom: 1px solid #e5e7eb;
		flex-wrap: wrap;
	}

	.session-header h3 {
		margin: 0;
		font-size: 18px;
		color: #0f172a;
	}

	.session-time {
		font-size: 14px;
		color: #64748b;
		margin-left: auto;
	}

	.session-date {
		font-size: 12px;
		color: #94a3b8;
	}

	.session-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.conversation-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.user-message,
	.assistant-message {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.user-message {
		flex-direction: row;
	}

	.assistant-message {
		flex-direction: row;
	}

	.message-label {
		font-weight: 700;
		font-size: 12px;
		padding: 4px 8px;
		border-radius: 4px;
		white-space: nowrap;
	}

	.user-message .message-label {
		background: #dbeafe;
		color: #1e40af;
	}

	.assistant-message .message-label {
		background: #f3e8ff;
		color: #6b21a8;
	}

	.message-content {
		flex: 1;
		padding: 12px;
		background: #f9fafb;
		border-radius: 8px;
		color: #334155;
		line-height: 1.6;
	}

	.user-message .message-content {
		background: #eff6ff;
	}

	.assistant-message .message-content {
		background: #faf5ff;
	}

	.message-time {
		font-size: 11px;
		color: #94a3b8;
		margin-left: 60px;
		margin-top: -4px;
	}
</style>

