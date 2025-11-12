-- conversation_records 테이블에 AI 설정 정보 컬럼 추가
-- 마이그레이션: 기존 테이블에 컬럼 추가

-- AI 선생님 성격 타입 (preset 또는 custom)
ALTER TABLE public.conversation_records 
ADD COLUMN IF NOT EXISTS personality_type VARCHAR(50);

-- AI 선생님 성격 키 (preset의 경우: friendly, strict, humorous, patient, professional)
-- custom의 경우 NULL
ALTER TABLE public.conversation_records 
ADD COLUMN IF NOT EXISTS personality_key VARCHAR(50);

-- AI 선생님 성격 이름 (한글 표시용)
ALTER TABLE public.conversation_records 
ADD COLUMN IF NOT EXISTS personality_name VARCHAR(100);

-- 시스템 프롬프트 (실제 사용된 프롬프트 저장)
ALTER TABLE public.conversation_records 
ADD COLUMN IF NOT EXISTS system_prompt TEXT;

-- 기존 데이터에 대한 기본값 설정 (선택사항)
-- UPDATE public.conversation_records 
-- SET personality_type = 'preset', personality_key = 'friendly', personality_name = '친근한 선생님'
-- WHERE personality_type IS NULL;

-- 인덱스 생성 (성격별 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_conversation_records_personality_key 
ON public.conversation_records(personality_key);

CREATE INDEX IF NOT EXISTS idx_conversation_records_personality_type 
ON public.conversation_records(personality_type);

