import React, { useEffect, useState, useMemo } from "react";
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Share,
  Platform
} from "react-native";
import { AppLogger, type LogCategory, type LogEntry } from "../services/appLogger";

type LogsModalProps = {
  visible: boolean;
  onClose: () => void;
};

type FilterCategory = "ALL" | LogCategory;

export function LogsModal({ visible, onClose }: LogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<FilterCategory>("ALL");
  const [copiedStatus, setCopiedStatus] = useState(false);

  useEffect(() => {
    const unsubscribe = AppLogger.subscribe((newLogs) => {
      setLogs(newLogs);
    });
    return () => unsubscribe();
  }, []);

  const filteredLogs = useMemo(() => {
    if (filter === "ALL") return logs;
    if (filter === "ERROR") return logs.filter((l) => l.level === "error" || l.category === "ERROR");
    return logs.filter((l) => l.category === filter);
  }, [logs, filter]);

  const handleShareLogs = async () => {
    if (!logs.length) return;
    const formatted = logs
      .slice()
      .reverse()
      .map((l) => `[${l.timestamp}] [${l.category}] ${l.message}`)
      .join("\n");

    try {
      await Share.share({
        title: "XConnect Diagnostics Log",
        message: `--- XConnect Diagnostics Log ---\n${formatted}`
      });
      setCopiedStatus(true);
      setTimeout(() => setCopiedStatus(false), 2500);
    } catch {
      // User dismissed
    }
  };

  const getCategoryColor = (category: LogCategory, level: string) => {
    if (level === "error" || category === "ERROR") return "#FF5252";
    if (level === "warn" || category === "WARN") return "#FFA726";
    switch (category) {
      case "BLE":
        return "#00E5FF";
      case "WIFI":
        return "#00E676";
      case "ULTRASONIC":
        return "#64FFDA";
      case "MOTION":
        return "#FF80AB";
      case "API":
        return "#B388FF";
      case "ROOM":
        return "#FFD700";
      default:
        return "#81D4FA";
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>📜 System Diagnostics & Logs</Text>
            <Text style={styles.headerSubtitle}>
              {logs.length} events recorded • Real-time stream
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterRow}>
          {(["ALL", "BLE", "WIFI", "ULTRASONIC", "MOTION", "API", "ROOM", "ERROR"] as FilterCategory[]).map((cat) => {
            const isSelected = filter === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setFilter(cat)}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {cat === "ALL" ? "All Logs" : cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Terminal Log Output */}
        <ScrollView style={styles.logList} contentContainerStyle={styles.logListContent}>
          {filteredLogs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No logs found for selected filter.</Text>
            </View>
          ) : (
            filteredLogs.map((item) => {
              const badgeColor = getCategoryColor(item.category, item.level);
              return (
                <View key={item.id} style={styles.logRow}>
                  <Text style={styles.logTime}>{item.timestamp}</Text>
                  <View style={[styles.badge, { borderColor: badgeColor }]}>
                    <Text style={[styles.badgeText, { color: badgeColor }]}>{item.category}</Text>
                  </View>
                  <Text
                    style={[
                      styles.logMsg,
                      item.level === "error" && styles.errorMsg,
                      item.level === "warn" && styles.warnMsg
                    ]}
                  >
                    {item.message}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Action Controls Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.shareBtn]}
            onPress={handleShareLogs}
            activeOpacity={0.7}
          >
            <Text style={styles.shareBtnText}>
              {copiedStatus ? "✓ Shared / Copied!" : "📋 Share / Copy All Logs"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.clearBtn]}
            onPress={() => AppLogger.clear()}
            activeOpacity={0.7}
          >
            <Text style={styles.clearBtnText}>🧹 Clear</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0D1117"
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#21262D",
    backgroundColor: "#161B22"
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#F0F6FC"
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#8B949E",
    marginTop: 2
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#30363D",
    borderRadius: 6
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#C9D1D9"
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#161B22",
    gap: 6,
    flexWrap: "wrap",
    borderBottomWidth: 1,
    borderBottomColor: "#21262D"
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "#21262D"
  },
  filterChipActive: {
    backgroundColor: "#00695C"
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8B949E"
  },
  filterChipTextActive: {
    color: "#E0F2F1",
    fontWeight: "700"
  },
  logList: {
    flex: 1,
    backgroundColor: "#0D1117"
  },
  logListContent: {
    padding: 12
  },
  emptyWrap: {
    paddingVertical: 40,
    alignItems: "center"
  },
  emptyText: {
    fontSize: 13,
    color: "#8B949E"
  },
  logRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 8
  },
  logTime: {
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#6E7681",
    width: 60,
    marginTop: 2
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 46,
    alignItems: "center"
  },
  badgeText: {
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "700"
  },
  logMsg: {
    flex: 1,
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#C9D1D9",
    lineHeight: 18
  },
  warnMsg: {
    color: "#FFA726"
  },
  errorMsg: {
    color: "#FF7B72",
    fontWeight: "700"
  },
  footer: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    backgroundColor: "#161B22",
    borderTopWidth: 1,
    borderTopColor: "#21262D"
  },
  actionBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  shareBtn: {
    flex: 2,
    backgroundColor: "#00695C"
  },
  shareBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700"
  },
  clearBtn: {
    flex: 1,
    backgroundColor: "#30363D"
  },
  clearBtnText: {
    color: "#C9D1D9",
    fontSize: 13,
    fontWeight: "700"
  }
});
