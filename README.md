# TensorTonic for VS Code — Unofficial

VS Code에서 TensorTonic 문제를 보고, Python 풀이를 작성하고, Run / Submit으로 채점합니다. 기본 학습 계획은 `pytorch-basics`입니다.

TensorTonic의 공식 확장이 아닙니다. 현재 Python 무료 문제와 Python 학습 계획 문제를 지원합니다. SQL, CUDA, Triton 및 별도의 프로젝트·면접 문제는 지원하지 않습니다.

## 설치

VS Code 1.95 이상이 필요합니다. Extensions 화면의 `…` → **Install from VSIX…**에서 설치 파일을 선택하거나 다음 명령을 사용합니다.

```sh
code --install-extension releases/tensortonic-vscode-0.2.1.vsix
```

풀이를 저장할 로컬 폴더를 VS Code에서 열고 TensorTonic 아이콘을 클릭합니다.

## 브라우저 연결

1. 브라우저에서 [TensorTonic](https://www.tensortonic.com/)에 평소처럼 로그인합니다. GitHub 로그인도 사이트에서 진행합니다.
2. VS Code 명령 팔레트에서 **TensorTonic: Connect browser**를 실행합니다.
3. 열린 JavaScript 문서의 연결 코드를 TensorTonic 탭의 개발자 도구 → Console에 붙여넣어 실행합니다. macOS의 Chrome 계열 브라우저는 `⌘⌥J`로 Console을 엽니다.
4. 브라우저에서 로컬 네트워크 연결 여부를 물으면 연결 목적을 확인한 뒤 허용합니다. 브라우저 탭을 열어 두면 VS Code 문제 목록이 표시됩니다.

연결이 진행되지 않으면 브라우저의 이 사이트에 대한 로컬 네트워크 권한을 확인하세요. 이 권한은 TensorTonic 탭이 같은 컴퓨터에서 실행 중인 VS Code의 임시 로컬 서버에 접속하는 데 필요합니다. 연결 요청은 30초 안에 응답이 없으면 안내와 함께 중단되므로 권한을 확인한 뒤 새 연결 코드를 실행합니다. 원격 브라우저·별도 VM 브라우저는 내 Mac의 `127.0.0.1`에 연결할 수 없습니다.

로그인 쿠키는 브라우저 밖으로 내보내지 않습니다. 확장은 임시로 열린 로컬 연결을 통해 허용된 TensorTonic 문제 API만 요청합니다. 연결 코드는 다른 사람에게 공유하거나 저장소에 커밋하지 마세요. **Disconnect browser**로 연결을 종료할 수 있습니다. 탭 새로고침 또는 VS Code 재시작 후에는 다시 연결합니다.

## 문제 풀기

- 사이드바에서 문제를 선택하면 문제 설명과 풀이 파일이 나란히 열립니다.
- 풀이 파일 위의 **Run**, **Submit**, **Description**, **Test cases** 버튼을 사용합니다.
- **Run**은 옆의 `.tests.json` 파일에 있는 테스트 케이스로 실행합니다. 이 파일은 JSON 배열 형식을 유지하면서 편집합니다.
- **Submit**은 현재 편집 중인 코드를 TensorTonic에 보내 사이트의 채점 결과를 표시합니다. 실행·제출은 TensorTonic 서버에서 처리됩니다.
- 기존 풀이 파일과 테스트 파일은 다시 문제를 열어도 덮어쓰지 않습니다.
- **Choose study plan**에 문제 URL의 `studyPlan` 값을 입력하면 학습 계획을 바꿉니다. 빈 값은 무료 문제 목록입니다.

풀이 파일 첫 줄의 `# tensortonic: {...}` 메타데이터는 문제와 파일을 연결하므로 유지하세요. 저장 위치는 기본적으로 현재 워크스페이스의 `tensortonic/<학습계획>/`입니다.

## Agent와 함께 문제 논의

- 풀이 위 **Discuss with Agent**를 누르면 VS Code 기본 Agent 채팅에 문제 설명·현재 풀이·테스트 파일이 첨부됩니다. 질문은 입력된 상태로 열리며 직접 전송합니다.
- 문제는 옆의 Markdown 미리보기에서 수식·예제와 함께 읽을 수 있고, `.problem.md` 원문은 Agent가 파일로 읽습니다. 개인 노트는 별도 파일에 작성하세요. 생성된 문제 파일을 수정했다면 덮어쓰지 않습니다.
- Agent는 `#tensortonicProblem` 도구로 선택된 문제와 **저장하지 않은 현재 코드**를 읽을 수 있습니다. 이 도구는 실행·제출·정답 조회를 하지 않습니다.
- 질문은 한 번에 한 단계씩 의논하고, 요청 전에는 완성 답안을 작성하지 않도록 시작합니다.
- Codex 확장을 사용하는 경우 **TensorTonic: Attach problem and solution to Codex**로 두 파일을 추가할 수 있습니다. Codex의 파일 첨부 명령이 제공되는 버전이 필요합니다. 기본 Chat 연동과 Codex 연동은 별개입니다.

## 설정과 확인

| 설정 | 기본값 | 의미 |
| --- | --- | --- |
| `tensortonic.studyPlan` | `pytorch-basics` | 학습 계획 slug. 빈 값은 무료 문제 |
| `tensortonic.solutionDirectory` | `tensortonic` | 워크스페이스 안의 상대 저장 폴더 |

**TensorTonic: Check connection and problem access** 명령은 연결, 문제 목록, 문제 설명과 시작 코드의 접근을 확인합니다. 실행 결과는 Output → TensorTonic에서 확인합니다.

이 확장은 TensorTonic 웹 클라이언트에서 확인한 API를 사용합니다. 공식 API 보장이 없어 사이트 변경 시 연동 수정이 필요할 수 있습니다. 유료 문제에는 기존 TensorTonic 구독 권한이 그대로 적용됩니다. 연결할 때는 현재 로그인된 계정이 맞는지 확인하세요.

## 이번 버전의 검증 범위

자동 테스트와 VS Code의 별도 프로필 VSIX 설치 검사를 통과했습니다. GitHub로 로그인한 실제 TensorTonic 계정에서 기존에 풀었던 Softmax 문제의 Run 3/3, Submit 43/43 통과 응답을 확인했습니다.

실제 Mac의 VS Code 1.144에서 확장 활성화와 연결 코드 생성까지 확인했습니다. 브라우저 로컬 네트워크 권한이 미승인인 상태에서 연결 대기 시간이 만료됐으므로, **설치된 확장 버튼 → 로컬 브라우저 연결 → 실제 채점**을 한 번에 잇는 최종 검증은 아직 완료하지 못했습니다. 문제 설명에는 Code의 Markdown 미리보기를 사용하며 웹사이트의 인터랙티브 시각화는 포함하지 않습니다.

## 개발과 패키징

외부 npm 패키지가 필요하지 않습니다. Node.js와 Python 3가 설치되어 있어야 합니다.

```sh
node --test test/*.test.js
python3 scripts/package.py
```

VS Code에서 이 소스 폴더를 열고 **Run TensorTonic extension** 설정을 실행하면 Extension Development Host에서 실행합니다. 개발 호스트에는 별도의 `test/workspace` 폴더를 엽니다. 부모 창에 열린 소스 폴더를 그대로 전달하면 Code가 중복 폴더를 제거해 빈 창이 열릴 수 있기 때문입니다. 원격 SSH·컨테이너·VS Code for the Web 환경은 지원하지 않습니다. 확장과 브라우저는 같은 컴퓨터에서 실행해야 합니다.

## 실제 계정 E2E 실행

아래 설정은 실제 Code와 로그인 계정을 사용하며 모의 서버를 사용하지 않습니다.

1. 이 저장소 폴더를 본인의 VS Code에서 엽니다.
2. Run and Debug에서 **TensorTonic: live account E2E**를 선택하고 **Run → Run Without Debugging**으로 실행합니다. 디버거를 붙인 실행에서는 설치된 Code의 Node 네트워크 계측 오류가 관찰됐습니다. 이 오류와 테스트 창 종료 사이의 인과관계는 확인되지 않았습니다.
3. 개발 호스트의 연결 안내를 읽고 임시 연결 코드를 로그인된 TensorTonic 브라우저 콘솔에서 실행합니다. 로컬 네트워크 연결 권한이 필요하며 확장과 같은 컴퓨터의 브라우저를 사용합니다.
4. 보고서는 **실행한 저장소**의 `dist/e2e-report.json`에 진행 중에도 저장됩니다. 이미 풀었던 Softmax 문제만 재제출하며, 미해결 상태이면 테스트를 중단합니다.

테스트가 끝나거나 연결 대기 시간이 만료되면 개발 호스트 창이 종료될 수 있습니다. 직접 문제를 풀거나 Agent와 계속 대화하려면 **Run TensorTonic extension** 설정을 사용하세요.

이 검증은 문제 열기·편집·Run·Submit·Agent 문맥 도구·채팅 첨부까지 검사합니다. Agent의 실제 답변 이해 여부는 채팅 화면에서 별도로 확인해야 하며, 자동 보고서에 완료된 것으로 기록하지 않습니다.

## 참고

문제 탐색, 설명 패널, Run / Submit CodeLens의 사용 흐름은 [LeetCode OpenSource VS Code 확장](https://github.com/LeetCode-OpenSource/vscode-leetcode)에서 영감을 받았습니다. 해당 확장의 LeetCode 전용 CLI 및 인증 코드는 포함하지 않았습니다. 이 구현의 소스 코드는 MIT 라이선스입니다. TensorTonic 이름과 서비스는 해당 소유자의 자산입니다.
