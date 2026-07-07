import requests
API_KEY = "fopnHuUQgjqPdFXZNDlYhjSrRCJ0TAddNpu7m1a6Kxk="
URL = "http://plus.kipris.or.kr/openapi/rest/patSearchInfoService/freeSearchInfo"

params = {
    "word": "화장료", 
    "accessKey": API_KEY,
    "pageNo": 1,
    "numOfRows": 5 # 테스트를 위해 5건만 요청
}

print("KIPRIS API 서버에 연결을 시도합니다...")

try:
    response = requests.get(URL, params=params)
    
    if response.status_code == 200:
        print("✅ 연결 성공! 데이터를 수신했습니다.\n")
        print(response.text[:800]) 
    else:
        print(f"❌ 오류 발생. 상태 코드: {response.status_code}")
        
except Exception as e:
    print(f"네트워크 오류 발생: {e}")
    