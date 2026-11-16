package app.suyajalrun.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ValueCallback;
import android.webkit.WebMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String HOST = "suyajalrun.vercel.app";
    private static final String HOME = "https://" + HOST + "/";
    private static final int PICK_IMAGE = 1;

    private WebView web;
    private Button retry;
    private Uri retryUrl = Uri.parse(HOME);
    private ValueCallback<Uri[]> fileCallback;
    private SamsungHealth health;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime();
                Insets safe = insets.getInsets(types);
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            }
            return insets;
        });
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        web = new WebView(this);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " SuyajalRunHealth/1");
        if (Build.VERSION.SDK_INT >= 34) health = new SamsungHealth(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        root.addView(web);

        retry = new Button(this);
        retry.setText("연결할 수 없습니다. 다시 시도");
        retry.setVisibility(View.GONE);
        root.addView(retry, new FrameLayout.LayoutParams(-2, -2, android.view.Gravity.CENTER));
        retry.setOnClickListener(view -> {
            retry.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            web.loadUrl(retryUrl.toString());
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !isSite(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "UTF-8", null);
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("suyajal-health".equals(url.getScheme())) {
                    String id = url.getLastPathSegment();
                    String currentUrl = view.getUrl();
                    if (request.isForMainFrame() && "runs".equals(url.getHost())
                            && id != null && id.matches("[0-9]{1,15}")
                            && currentUrl != null && isSite(Uri.parse(currentUrl))) {
                        long ticket = Long.parseLong(id);
                        if (health == null) sendHealth(ticket, null, "삼성헬스 연동은 Android 14 이상에서 사용할 수 있습니다.");
                        else health.load(ticket);
                    }
                    return true;
                }
                boolean blocked = !isSite(request.getUrl());
                if (blocked && request.isForMainFrame() && request.hasGesture()) {
                    Toast.makeText(MainActivity.this, "앱에서 외부 사이트를 열 수 없습니다.",
                            Toast.LENGTH_SHORT).show();
                }
                return blocked;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showRetry(request.getUrl());
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showRetry(request.getUrl());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("image/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/png", "image/jpeg"});
                try {
                    startActivityForResult(picker, PICK_IMAGE);
                } catch (ActivityNotFoundException error) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        setContentView(root);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBackOrClose);
        }
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    private static boolean isSite(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme()) && HOST.equalsIgnoreCase(url.getHost())
                && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443);
    }

    void sendHealth(long ticket, org.json.JSONArray runs, String error) {
        if (isDestroyed() || web.getUrl() == null || !isSite(Uri.parse(web.getUrl()))) return;
        org.json.JSONObject result = new org.json.JSONObject();
        try {
            result.put("suyajalHealthRequest", ticket);
            result.put("runs", runs);
            result.put("error", error);
        } catch (org.json.JSONException e) {
            throw new IllegalStateException(e);
        }
        web.postWebMessage(new WebMessage(result.toString()), Uri.parse(HOME));
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (health != null && requestCode == SamsungHealth.PERMISSION_REQUEST) health.onPermissions();
    }

    private void showRetry(Uri url) {
        if (isSite(url)) retryUrl = url;
        web.setVisibility(View.INVISIBLE);
        retry.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_IMAGE || fileCallback == null) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        String type = uri != null && "content".equals(uri.getScheme())
                ? getContentResolver().getType(uri) : null;
        callback.onReceiveValue("image/png".equals(type) || "image/jpeg".equals(type)
                ? new Uri[] {uri} : null);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    public void onBackPressed() {
        goBackOrClose();
    }

    private void goBackOrClose() {
        if (web.canGoBack()) {
            retry.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            web.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        ((FrameLayout) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
