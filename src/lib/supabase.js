import { createClient } from '@supabase/supabase-js';

// 환경 변수에서 Supabase 설정 가져오기
const supabaseUrl = import.meta.env.VITE_SUPABASE_DB_URL || import.meta.env.SUPABASE_DB_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_DB_PUBLIC_KEY || import.meta.env.SUPABASE_DB_PUBLIC_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	console.warn('Supabase 환경 변수가 설정되지 않았습니다. VITE_SUPABASE_DB_URL와 VITE_SUPABASE_DB_PUBLIC_KEY를 확인하세요.');
}

// Supabase 클라이언트 생성
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true
	}
});

