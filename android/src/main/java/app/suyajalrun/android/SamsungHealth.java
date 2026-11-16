package app.suyajalrun.android;

import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.HealthConnectManager;
import android.health.connect.HealthConnectException;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.units.Length;
import android.os.OutcomeReceiver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

final class SamsungHealth {
    static final int PERMISSION_REQUEST = 2;
    private static final String EXERCISE = "android.permission.health.READ_EXERCISE";
    private static final String DISTANCE = "android.permission.health.READ_DISTANCE";
    private static final DataOrigin SAMSUNG = new DataOrigin.Builder()
            .setPackageName("com.sec.android.app.shealth").build();
    private static final String READ_ERROR = "Health Connect 기록을 읽지 못했습니다. 앱 권한을 확인하고 다시 시도해 주세요.";
    private static final int MAX_RUNS = 30;

    private final MainActivity activity;
    private final HealthConnectManager manager;
    private Long permissionTicket;

    SamsungHealth(MainActivity activity) {
        this.activity = activity;
        manager = activity.getSystemService(HealthConnectManager.class);
    }

    void load(long ticket) {
        if (manager == null) {
            activity.sendHealth(ticket, null, "이 기기에서 Health Connect를 사용할 수 없습니다.");
        } else if (!granted(EXERCISE) || !granted(DISTANCE)) {
            if (permissionTicket == null) {
                permissionTicket = ticket;
                activity.requestPermissions(new String[]{EXERCISE, DISTANCE}, PERMISSION_REQUEST);
            } else {
                permissionTicket = ticket;
            }
        } else {
            read(ticket);
        }
    }

    void onPermissions() {
        Long ticket = permissionTicket;
        permissionTicket = null;
        if (ticket == null) return;
        if (granted(EXERCISE)) read(ticket);
        else activity.sendHealth(ticket, null,
                "Health Connect 앱 권한에서 Suyajal Run의 운동 읽기를 허용해 주세요.");
    }

    private boolean granted(String permission) {
        return activity.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private void read(long ticket) {
        Instant end = Instant.now();
        readSessions(ticket, range(end.minus(Duration.ofDays(30)), end), -1, new ArrayList<>());
    }

    private void readSessions(long ticket, TimeInstantRangeFilter window, long pageToken,
                              List<ExerciseSessionRecord> runs) {
        ReadRecordsRequestUsingFilters.Builder<ExerciseSessionRecord> request =
                new ReadRecordsRequestUsingFilters.Builder<>(ExerciseSessionRecord.class)
                        .addDataOrigins(SAMSUNG).setTimeRangeFilter(window).setAscending(false);
        if (pageToken != -1) request.setPageToken(pageToken);
        try {
            manager.readRecords(request.build(), activity.getMainExecutor(),
                    receiver(ticket, (ReadRecordsResponse<ExerciseSessionRecord> response) -> {
                        for (ExerciseSessionRecord session : response.getRecords()) {
                            int type = session.getExerciseType();
                            if (type == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING
                                    || type == ExerciseSessionType.EXERCISE_SESSION_TYPE_RUNNING_TREADMILL) {
                                runs.add(session);
                                if (runs.size() == MAX_RUNS) break;
                            }
                        }
                        if (runs.size() < MAX_RUNS && response.getNextPageToken() != -1) {
                            readSessions(ticket, window, response.getNextPageToken(), runs);
                        } else {
                            readDistances(ticket, runs, 0, new JSONArray());
                        }
                    }));
        } catch (SecurityException e) {
            activity.sendHealth(ticket, null, READ_ERROR);
        }
    }

    private void readDistances(long ticket, List<ExerciseSessionRecord> runs, int index, JSONArray result) {
        if (activity.isDestroyed()) return;
        if (index == runs.size()) {
            activity.sendHealth(ticket, result, null);
            return;
        }
        ExerciseSessionRecord run = runs.get(index);
        if (!granted(DISTANCE)) {
            appendRun(ticket, runs, index, result, 0);
            return;
        }
        AggregateRecordsRequest<Length> request = new AggregateRecordsRequest.Builder<Length>(
                range(run.getStartTime(), run.getEndTime()))
                .addAggregationType(DistanceRecord.DISTANCE_TOTAL).addDataOriginsFilter(SAMSUNG).build();
        try {
            manager.aggregate(request, activity.getMainExecutor(), receiver(ticket, response -> {
                Length distance = response.get(DistanceRecord.DISTANCE_TOTAL);
                appendRun(ticket, runs, index, result, distance == null ? 0 : distance.getInMeters());
            }));
        } catch (SecurityException e) {
            activity.sendHealth(ticket, null, READ_ERROR);
        }
    }

    private void appendRun(long ticket, List<ExerciseSessionRecord> runs, int index,
                           JSONArray result, double distance) {
        ExerciseSessionRecord run = runs.get(index);
        Instant start = run.getStartTime();
        try {
            JSONObject item = new JSONObject();
            item.put("start", start.toString());
            item.put("date", start.atZone(ZoneId.of("Asia/Seoul")).toLocalDate().toString());
            item.put("duration_sec", Math.max(1, Duration.between(start, run.getEndTime()).getSeconds()));
            item.put("distance_m", Math.round(distance));
            result.put(item);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
        readDistances(ticket, runs, index + 1, result);
    }

    private static TimeInstantRangeFilter range(Instant start, Instant end) {
        return new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build();
    }

    private <T> OutcomeReceiver<T, HealthConnectException> receiver(long ticket, Consumer<T> consume) {
        return new OutcomeReceiver<T, HealthConnectException>() {
            @Override
            public void onResult(T result) {
                if (!activity.isDestroyed()) consume.accept(result);
            }

            @Override
            public void onError(HealthConnectException error) {
                activity.sendHealth(ticket, null, READ_ERROR);
            }
        };
    }
}
