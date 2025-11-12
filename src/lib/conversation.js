import { supabase } from './supabase.js';

// 사용자 프로필 생성 또는 업데이트
export async function ensureUserProfile(userId, email) {
	try {
		const { data, error } = await supabase
			.from('users')
			.upsert(
				{
					id: userId,
					email: email,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'id' }
			)
			.select()
			.single();

		if (error) throw error;
		return { success: true, data };
	} catch (error) {
		console.error('사용자 프로필 생성/업데이트 오류:', error);
		return { success: false, error: error.message };
	}
}

// 대화 기록 저장
export async function saveConversation(userId, userMessage, assistantReply) {
	try {
		// 먼저 사용자 프로필 확인
		const { data: userData } = await supabase
			.from('users')
			.select('id')
			.eq('id', userId)
			.single();

		if (!userData) {
			// 사용자 프로필이 없으면 생성
			const { data: user } = await supabase.auth.getUser();
			if (user?.user?.email) {
				await ensureUserProfile(userId, user.user.email);
			}
		}

		const { data, error } = await supabase
			.from('conversation_records')
			.insert({
				user_id: userId,
				user_message: userMessage,
				assistant_reply: assistantReply
			})
			.select()
			.single();

		if (error) throw error;
		return { success: true, data };
	} catch (error) {
		console.error('대화 기록 저장 오류:', error);
		return { success: false, error: error.message };
	}
}

// 대화 기록 조회 (세션별 그룹화)
export async function getConversationHistory(userId) {
	try {
		const { data, error } = await supabase
			.from('conversation_records')
			.select('*')
			.eq('user_id', userId)
			.order('created_at', { ascending: false });

		if (error) throw error;

		// 세션별로 그룹화 (30분 이내의 대화를 하나의 세션으로 묶음)
		const sessions = [];
		let currentSession = null;
		const SESSION_TIMEOUT = 30 * 60 * 1000; // 30분 (밀리초)

		data.forEach((record) => {
			const recordTime = new Date(record.created_at).getTime();

			if (!currentSession || 
				recordTime - currentSession.startTime > SESSION_TIMEOUT) {
				// 새 세션 시작
				currentSession = {
					id: record.id,
					startTime: recordTime,
					endTime: recordTime,
					records: [record]
				};
				sessions.push(currentSession);
			} else {
				// 기존 세션에 추가
				currentSession.records.push(record);
				currentSession.endTime = recordTime;
			}
		});

		// 각 세션의 기록을 시간순으로 정렬 (오래된 것부터)
		sessions.forEach((session) => {
			session.records.sort((a, b) => 
				new Date(a.created_at) - new Date(b.created_at)
			);
		});

		return { success: true, data: sessions };
	} catch (error) {
		console.error('대화 기록 조회 오류:', error);
		return { success: false, error: error.message };
	}
}

// 특정 세션의 대화 기록 조회
export async function getSessionRecords(userId, sessionStartTime) {
	try {
		const sessionEndTime = sessionStartTime + (30 * 60 * 1000); // 30분 후

		const { data, error } = await supabase
			.from('conversation_records')
			.select('*')
			.eq('user_id', userId)
			.gte('created_at', new Date(sessionStartTime).toISOString())
			.lte('created_at', new Date(sessionEndTime).toISOString())
			.order('created_at', { ascending: true });

		if (error) throw error;
		return { success: true, data };
	} catch (error) {
		console.error('세션 기록 조회 오류:', error);
		return { success: false, error: error.message };
	}
}

