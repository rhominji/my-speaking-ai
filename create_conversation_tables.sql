-- 사용자 프로필 테이블 생성
-- Supabase auth.users와 연동
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 영어 회화 기록 테이블 생성
CREATE TABLE IF NOT EXISTS public.conversation_records (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    user_message TEXT NOT NULL,
    assistant_reply TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Row Level Security (RLS) 활성화
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_records ENABLE ROW LEVEL SECURITY;

-- users 테이블 정책: 사용자는 자신의 정보만 조회/수정/생성 가능
CREATE POLICY "Users can view own profile"
ON public.users
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
ON public.users
FOR INSERT
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON public.users
FOR UPDATE
USING (auth.uid() = id);

-- conversation_records 테이블 정책: 사용자는 자신의 기록만 조회/생성 가능
CREATE POLICY "Users can view own records"
ON public.conversation_records
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own records"
ON public.conversation_records
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 인덱스 생성 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_conversation_records_user_id ON public.conversation_records(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_records_created_at ON public.conversation_records(created_at DESC);

