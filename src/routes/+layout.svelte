<script>
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { initAuth, user, signOut } from '$lib/auth.js';
	import { goto } from '$app/navigation';
	
	let { children } = $props();

	onMount(() => {
		initAuth();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<nav class="navbar">
	<div class="nav-container">
		<a href="/" class="nav-logo">🎙️ Speaking AI</a>
		<div class="nav-links">
			{#if $user}
				<a href="/history" class="nav-link">대화 기록</a>
				<span class="user-email">{$user.email}</span>
				<button class="nav-button" onclick={async () => { await signOut(); goto('/login'); }}>로그아웃</button>
			{:else}
				<a href="/login" class="nav-link">로그인</a>
				<a href="/signup" class="nav-link nav-link-primary">회원가입</a>
			{/if}
		</div>
	</div>
</nav>

{@render children()}

<style>
	.navbar {
		background: white;
		border-bottom: 1px solid #e5e7eb;
		padding: 0 16px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	.nav-container {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 64px;
	}

	.nav-logo {
		font-size: 20px;
		font-weight: 700;
		color: #0f172a;
		text-decoration: none;
	}

	.nav-logo:hover {
		opacity: 0.8;
	}

	.nav-links {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.user-email {
		font-size: 14px;
		color: #64748b;
	}

	.nav-link {
		font-size: 14px;
		color: #334155;
		text-decoration: none;
		padding: 8px 16px;
		border-radius: 6px;
		transition: background-color 0.2s;
	}

	.nav-link:hover {
		background-color: #f3f4f6;
	}

	.nav-link-primary {
		background-color: #2563eb;
		color: white;
	}

	.nav-link-primary:hover {
		background-color: #1d4ed8;
	}

	.nav-button {
		font-size: 14px;
		color: #334155;
		background: none;
		border: 1px solid #d1d5db;
		padding: 8px 16px;
		border-radius: 6px;
		cursor: pointer;
		transition: background-color 0.2s;
	}

	.nav-button:hover {
		background-color: #f3f4f6;
	}
</style>
