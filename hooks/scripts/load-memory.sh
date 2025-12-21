#!/bin/bash

MEMORY_DIR="$HOME/.claude/memory-keeper/sessions"
PROJECT_NAME=$(basename "$CLAUDE_PROJECT_DIR")

# 디렉토리 없으면 생성하고 종료
if [ ! -d "$MEMORY_DIR" ]; then
    mkdir -p "$MEMORY_DIR"
    exit 0
fi

# 현재 프로젝트 관련 세션 찾기 (최근 3개)
PROJECT_FILES=$(ls -t "$MEMORY_DIR"/${PROJECT_NAME}_*.md 2>/dev/null | head -3)

# 다른 프로젝트 최근 세션 (최근 2개, 컨텍스트 공유용)
OTHER_FILES=$(ls -t "$MEMORY_DIR"/*.md 2>/dev/null | grep -v "^$MEMORY_DIR/${PROJECT_NAME}_" | head -2)

if [ -z "$PROJECT_FILES" ] && [ -z "$OTHER_FILES" ]; then
    exit 0
fi

echo "=== 🧠 SESSION MEMORY LOADED ==="
echo ""

if [ -n "$PROJECT_FILES" ]; then
    echo "📁 This Project ($PROJECT_NAME):"
    echo "---"
    for f in $PROJECT_FILES; do
        echo ""
        echo "### $(basename "$f" .md)"
        cat "$f"
    done
fi

if [ -n "$OTHER_FILES" ]; then
    echo ""
    echo "🌐 Recent from other projects:"
    echo "---"
    for f in $OTHER_FILES; do
        echo ""
        echo "### $(basename "$f" .md)"
        head -20 "$f"
        echo "..."
    done
fi

echo ""
echo "=== END MEMORY ==="
