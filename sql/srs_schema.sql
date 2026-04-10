-- 微信读书笔记 SRS (Spaced Repetition System) 表结构
-- 与现有 PostgREST PostgreSQL 数据库配套使用

-- ========================================
-- 1. flashcards - 卡片主表
-- ========================================
CREATE TABLE IF NOT EXISTS flashcards (
    card_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_vid TEXT NOT NULL,
    highlight_id INTEGER REFERENCES highlights(id) ON DELETE SET NULL,
    card_type TEXT NOT NULL CHECK (card_type IN ('highlight', 'qa', 'concept')),
    question_text TEXT NOT NULL,
    reference_text TEXT,
    book_id TEXT REFERENCES books(book_id),
    chapter_uid INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    auto_generated BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_vid);
CREATE INDEX IF NOT EXISTS idx_flashcards_book ON flashcards(book_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_highlight ON flashcards(highlight_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_active ON flashcards(user_vid, is_active);

-- 添加更新触发器
DROP TRIGGER IF EXISTS update_flashcards_updated_at ON flashcards;
CREATE TRIGGER update_flashcards_updated_at
    BEFORE UPDATE ON flashcards
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ========================================
-- 2. card_answers - 手动解答/知识点拓展
-- ========================================
CREATE TABLE IF NOT EXISTS card_answers (
    answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES flashcards(card_id) ON DELETE CASCADE,
    user_vid TEXT NOT NULL,
    answer_type TEXT CHECK (answer_type IN ('manual_answer', 'expansion', 'hint')),
    content TEXT NOT NULL,
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_card_answers_card ON card_answers(card_id);
CREATE INDEX IF NOT EXISTS idx_card_answers_user ON card_answers(user_vid);

-- 添加更新触发器
DROP TRIGGER IF EXISTS update_card_answers_updated_at ON card_answers;
CREATE TRIGGER update_card_answers_updated_at
    BEFORE UPDATE ON card_answers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ========================================
-- 3. card_reviews - 复习记录 (SR 算法核心)
-- 每张卡片只保留一条最新记录
-- ========================================
CREATE TABLE IF NOT EXISTS card_reviews (
    review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id UUID NOT NULL REFERENCES flashcards(card_id) ON DELETE CASCADE,
    user_vid TEXT NOT NULL,
    reviewed_at TIMESTAMP,
    scheduled_at TIMESTAMP NOT NULL,
    ease_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetition_count INTEGER DEFAULT 0,
    lapses INTEGER DEFAULT 0,
    state TEXT DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning', 'suspended')),
    strategy TEXT DEFAULT 'sm2'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_reviews_card ON card_reviews(card_id);
CREATE INDEX IF NOT EXISTS idx_card_reviews_scheduled ON card_reviews(user_vid, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_card_reviews_state ON card_reviews(user_vid, state);


-- ========================================
-- 4. 验证表创建结果
-- ========================================
SELECT
    'flashcards' as table_name,
    COUNT(*) as column_count
FROM information_schema.columns
WHERE table_name = 'flashcards'
UNION ALL
SELECT
    'card_answers',
    COUNT(*)
FROM information_schema.columns
WHERE table_name = 'card_answers'
UNION ALL
SELECT
    'card_reviews',
    COUNT(*)
FROM information_schema.columns
WHERE table_name = 'card_reviews';
