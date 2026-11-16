package app.suyajalrun.android;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;

public final class HealthPrivacyActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        TextView text = new TextView(this);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        text.setPadding(padding, padding * 2, padding, padding);
        text.setTextSize(17);
        text.setText("Suyajal Run · 건강 데이터 사용 안내\n\n"
                + "삼성헬스 연동을 누르면 Health Connect에서 삼성 헬스의 러닝 기록과 거리를 읽습니다. "
                + "기록을 선택하고 확인 후 저장하면 운동 날짜, 시간, 거리와 입력한 수치가 Suyajal Run 계정에 저장됩니다. "
                + "친구와 그룹 공유 범위는 저장 화면에서 선택할 수 있습니다.\n\n"
                + "읽기 권한은 Health Connect의 앱 권한 설정에서 철회할 수 있습니다.");
        setContentView(text);
    }
}
