-- test_table 생성
CREATE TABLE IF NOT EXISTS public.test_table (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Row Level Security (RLS) 비활성화 (테스트용)
ALTER TABLE public.test_table ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기/쓰기 가능하도록 정책 생성 (테스트용)
CREATE POLICY "Allow all operations for test_table"
ON public.test_table
FOR ALL
USING (true)
WITH CHECK (true);

-- 인덱스 생성 (선택사항)
CREATE INDEX IF NOT EXISTS idx_test_table_created_at ON public.test_table(created_at);
CREATE INDEX IF NOT EXISTS idx_test_table_email ON public.test_table(email);


