import { supabase } from './supabase.js';
import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getRedirectURL } from './utils.js';

// 사용자 인증 상태 스토어
export const user = writable(null);
export const session = writable(null);

// 인증 상태 초기화
export async function initAuth() {
	if (!browser) return;

	try {
		const { data: { session: currentSession } } = await supabase.auth.getSession();
		session.set(currentSession);
		user.set(currentSession?.user ?? null);

		// 인증 상태 변경 감지
		supabase.auth.onAuthStateChange(async (event, newSession) => {
			session.set(newSession);
			user.set(newSession?.user ?? null);

			// 이메일 확인 완료 이벤트 처리
			if (event === 'SIGNED_IN' && newSession?.user) {
				// 이메일 확인이 완료된 경우
				console.log('사용자 로그인:', newSession.user.email);
			}
		});
	} catch (error) {
		console.error('인증 초기화 오류:', error);
	}
}

// 로그인
export async function signIn(email, password) {
	try {
		const { data, error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) throw error;
		return { success: true, data };
	} catch (error) {
		return { success: false, error: error.message };
	}
}

// 회원가입
export async function signUp(email, password, redirectTo = '/auth/confirm') {
	try {
		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				emailRedirectTo: getRedirectURL(redirectTo)
			}
		});

		if (error) throw error;
		return { success: true, data };
	} catch (error) {
		return { success: false, error: error.message };
	}
}

// 로그아웃
export async function signOut() {
	try {
		const { error } = await supabase.auth.signOut();
		if (error) throw error;
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
}

