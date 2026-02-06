import argparse
import requests
import time
import os

# 配置（支持环境变量覆盖）
GATEWAY_URL = os.getenv("ATYPICA_GATEWAY_URL", "http://127.0.0.1:18789")
USER_ID = os.getenv("ATYPICA_USER_ID", "testuser")
PROJECT_ID = os.getenv("ATYPICA_PROJECT_ID", "main")
INBOUND_API_KEY = os.getenv("ATYPICA_INBOUND_API_KEY", "test")
DEFAULT_RESPONSE_MODE = os.getenv("ATYPICA_RESPONSE_MODE", "sync")


def normalize_response_mode(value: str) -> str:
    mode = (value or "").strip().lower()
    return "sync" if mode == "sync" else "async"


def get_headers():
    """构建请求头，包含 API key 认证"""
    headers = {"Content-Type": "application/json"}
    if INBOUND_API_KEY:
        # 使用 Authorization Bearer 方式（推荐）
        headers["Authorization"] = f"Bearer {INBOUND_API_KEY}"
        # 或者使用 X-API-Key 方式（备选）
        # headers["X-API-Key"] = INBOUND_API_KEY
    return headers


def send_message(text: str, response_mode: str) -> bool:
    print("\n📤 [Client] 发送消息到 OpenClaw...")
    print(f"🧭 响应模式: {response_mode}")
    if INBOUND_API_KEY:
        print("🔑 使用 API Key 认证")
    else:
        print("⚠️  未配置 API Key（如果服务器要求认证，请求将失败）")

    url = f"{GATEWAY_URL}/atypica/inbound"
    payload = {
        "userId": USER_ID,
        "projectId": PROJECT_ID,
        "message": text,
        "responseMode": response_mode,
    }

    try:
        headers = get_headers()
        response = requests.post(url, json=payload, headers=headers)

        if response.status_code == 401:
            print(f"❌ 认证失败 (HTTP 401): {response.text}")
            print("💡 提示: 请设置环境变量 ATYPICA_INBOUND_API_KEY 或在代码中配置 INBOUND_API_KEY")
            return False

        if response_mode == "sync":
            if response.status_code != 200:
                print(f"❌ 同步模式请求失败: {response.status_code} - {response.text}")
                return False
            try:
                data = response.json()
            except Exception:
                print(f"❌ 返回不是有效 JSON: {response.text}")
                return False
            print("✅ 同步调用成功 (HTTP 200)")
            print(f"🤖 Reply: {data.get('reply', '[Empty reply]')}")
            return True

        if response.status_code == 202:
            print("✅ 异步请求已接收 (HTTP 202)")
            return True

        # 兼容：如果服务端返回了同步结构，也尽量展示结果
        if response.status_code == 200:
            try:
                data = response.json()
            except Exception:
                data = {}
            print("✅ 收到同步响应 (HTTP 200)")
            if "reply" in data:
                print(f"🤖 Reply: {data.get('reply')}")
            return True

        print(f"❌ 发送失败: {response.status_code} - {response.text}")
        return False
    except Exception as e:
        print(f"❌ 请求异常: {e}")
        return False


def check_history():
    print("\n📜 [Client] 查询会话历史...")
    url = f"{GATEWAY_URL}/atypica/messages"
    params = {
        "userId": USER_ID,
        "projectId": PROJECT_ID,
        "limit": 10,
    }

    try:
        headers = get_headers()
        response = requests.get(url, params=params, headers=headers)
        if response.status_code == 200:
            data = response.json()
            messages = data.get("messages", [])
            print(f"✅ 成功获取 {len(messages)} 条记录:")
            for msg in messages:
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                print(f"  - [{role}]: {content[:100]}...")
        elif response.status_code == 401:
            print(f"❌ 认证失败 (HTTP 401): {response.text}")
            print("💡 提示: 请设置环境变量 ATYPICA_INBOUND_API_KEY 或在代码中配置 INBOUND_API_KEY")
        else:
            print(f"❌ 获取失败: {response.status_code} - {response.text}")
    except Exception as e:
        print(f"❌ 请求异常: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atypica inbound 测试客户端")
    parser.add_argument("message", nargs="*", help="要发送的消息")
    parser.add_argument("--mode", choices=["async", "sync"], default=normalize_response_mode(DEFAULT_RESPONSE_MODE), help="响应模式")
    parser.add_argument("--no-history", action="store_true", help="发送后不查询历史")
    args = parser.parse_args()

    msg = " ".join(args.message).strip() if args.message else "你好啊"
    mode = normalize_response_mode(args.mode)

    # 显示配置信息
    print("🔧 配置信息:")
    print(f"  Gateway URL: {GATEWAY_URL}")
    print(f"  User ID: {USER_ID}")
    print(f"  Project ID: {PROJECT_ID}")
    print(f"  Response Mode: {mode}")
    if INBOUND_API_KEY:
        masked = "*" * max(len(INBOUND_API_KEY) - 4, 0) + INBOUND_API_KEY[-4:]
        print(f"  API Key: {masked}")
    else:
        print("  API Key: (未设置)")

    if send_message(msg, mode) and not args.no_history:
        if mode == "async":
            print("\n⏳ 等待 5 秒让 Agent 思考并触发 Webhook 推送...")
            time.sleep(5)
        check_history()
